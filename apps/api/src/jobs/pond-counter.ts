import { type Queryable, transaction } from "@kuutti/db";
import { moveFigures, type PondCounterCounts, seeksBand } from "@kuutti/schema";
import { CURRENT_CONSENT_VERSIONS } from "../identity/index.ts";
import { finnishDay } from "../lib/finnish-day.ts";
import type { Logger } from "../lib/logger.ts";
import { preferencesFrom } from "../matching/index.ts";
import { readPondCounterK, readStandingFigures } from "../pond/index.ts";
import type { NightlyJob } from "./nightly.ts";
import { PROFILE_FACTS, profileComplete } from "./pool.ts";

/**
 * The pond counter's figures (#54, #581, ADR-013). It counts the people
 * themselves: live, bank-verified accounts that have told their home, with a
 * finished profile. There is one pond, the country, so one count and one row
 * (ADR-061 §8, #607). Once a day they are counted, and the figures move when at
 * least k people have come or gone since they were taken (`moveFigures`): a
 * count that followed every day would say that one person finished that day,
 * and with the bar what they seek. The pond slice's route serves the figures
 * after suppression. It lives here and not in a slice because it reads across
 * several (accounts, profiles, photos, preferences) and none of them should
 * depend on the others for it (rules/layout.md).
 *
 * Raw parameterised SQL for the same reason as pond/repo.ts: `db` is the
 * Queryable seam the test harness hands a rolled-back transaction through.
 * No statement here takes input from a request.
 */
export type PondCounterDeps = {
  db: Queryable;
  logger: Logger;
  now: () => Date;
};

/**
 * One count at a time, across every process that may run one (two containers
 * overlap during a deploy, and each takes the first figures at boot). Without
 * it two counts read the same standing row, each finds that the number has
 * moved by k, and the second overwrites the first with a number one person
 * apart: the very difference the step rule is there to keep from being said.
 */
export const POND_COUNTER_LOCK_KEY = 725_121_154;

type FactsRow = {
  display_name: string | null;
  bio: string | null;
  bio_preset: string | null;
  prompts: unknown;
  approved_photos: string;
  seeks: unknown;
  age_window: unknown;
  seeks_consented: boolean;
};

/**
 * The exact counts. One read over every account that may have a finished
 * profile, with no account id in what comes back: this is a nightly aggregate,
 * not a caller's data (rule 6 is about a session's own rows). The tables are
 * the shared ones of packages/db, read only. A shadow-banned account counts
 * exactly like an active one: left out, its owner could find the ban out by
 * taking a photo away and watching whether the figures ever follow. Whether a
 * profile is complete is decided by `completeness()` itself, from the same
 * facts the profile screen gathers, so the counter and the screen cannot
 * disagree. A band holds only somebody whose consent to the answer is current,
 * as the rounds ask, and the current wording is what names this count (ADR-013
 * §20): a finished profile on an older wording is finished, and in no band.
 */
export async function countPond(db: Queryable): Promise<PondCounterCounts> {
  const { rows } = await db.query<FactsRow>(
    `SELECT p.display_name, p.bio, p.bio_preset, p.prompts,
            ${PROFILE_FACTS},
            EXISTS (SELECT 1 FROM consent c
              WHERE c.account_id = a.id AND c.kind = 'special_category'
                AND c.withdrawn_at IS NULL AND c.version = $1) AS seeks_consented
     FROM account a
     JOIN identity i ON i.id = a.identity_id
     LEFT JOIN profile p ON p.account_id = a.id
     WHERE a.home_place IS NOT NULL
       AND a.state IN ('active', 'shadow_banned')
       AND i.standing = 'ok'`,
    [CURRENT_CONSENT_VERSIONS.special_category],
  );
  const counts: PondCounterCounts = { finished: 0, seeksMen: 0, seeksEveryone: 0, seeksWomen: 0 };
  for (const row of rows) {
    const preferences = preferencesFrom({ seeks: row.seeks, ageWindow: row.age_window });
    if (!profileComplete(row, preferences)) continue;
    counts.finished += 1;
    const band = row.seeks_consented ? seeksBand(preferences.seeks) : null;
    if (band) counts[band] += 1;
  }
  return counts;
}

/** `counted` is false when the day had its count already and this run did nothing. */
export type SnapshotResult = { day: string; moved: boolean; counted: boolean };

/**
 * Counts the people and moves the figures if they have moved far enough. The
 * row is there from the first count on, one of zeros while nobody is counted.
 * One row: the figures that are replaced are gone, and no series of daily
 * counts is kept.
 *
 * At most one count a Finnish calendar day, whichever process asks: every API
 * process arms the nightly job, and two that overlap during a deploy take the
 * lock one after the other. The row's `taken_at` is the last count, so it says
 * which day was counted last.
 */
export async function takeSnapshot(deps: PondCounterDeps): Promise<SnapshotResult> {
  const at = deps.now();
  const day = finnishDay(at);
  const result = await transaction(deps.db, async (tx) => {
    // Before anything is read: what this count compares with must be what the last one left.
    await tx.query("SELECT pg_advisory_xact_lock($1)", [POND_COUNTER_LOCK_KEY]);
    const last = await tx.query<{ at: Date }>("SELECT taken_at AS at FROM pond_counter");
    const lastAt = last.rows[0]?.at ?? null;
    if (lastAt !== null && finnishDay(lastAt) === day) {
      return { day, moved: false, counted: false };
    }
    const k = await readPondCounterK(tx);
    const today = await countPond(tx);
    const had = await readStandingFigures(tx);
    const was = had?.counts ?? null;
    const next = moveFigures(was, today, k);
    if (next === was) {
      // Counted too, though nothing moved: the mark of the day's count.
      await tx.query("UPDATE pond_counter SET taken_at = $1", [at]);
      return { day, moved: false, counted: true };
    }
    // The public `day` belongs to the public number: a move of the bands alone
    // leaves it, or it would say in public that whom people seek has changed.
    const movedOn = had && next.finished === had.counts.finished ? had.day : day;
    await tx.query(
      `INSERT INTO pond_counter (day, finished, seeks_men, seeks_everyone, seeks_women, taken_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE
         SET day = EXCLUDED.day, finished = EXCLUDED.finished, seeks_men = EXCLUDED.seeks_men,
             seeks_everyone = EXCLUDED.seeks_everyone, seeks_women = EXCLUDED.seeks_women,
             taken_at = EXCLUDED.taken_at`,
      [movedOn, next.finished, next.seeksMen, next.seeksEveryone, next.seeksWomen, at],
    );
    return { day, moved: true, counted: true };
  });
  // Whether the figures moved, never who, where or how many people.
  deps.logger.info(result, result.counted ? "pond counter" : "pond counter: counted today already");
  return result;
}

/** The first figures for a database that has none, so the route has something to say after a first deploy. */
export async function ensureFirstSnapshot(deps: PondCounterDeps): Promise<SnapshotResult | null> {
  const { rows } = await deps.db.query("SELECT 1 FROM pond_counter LIMIT 1");
  return rows.length === 0 ? takeSnapshot(deps) : null;
}

/** The nightly job: the day's count. */
export function pondCounterJob(deps: PondCounterDeps): NightlyJob {
  return {
    name: "pond-counter",
    run: async () => ({ moved: Number((await takeSnapshot(deps)).moved) }),
  };
}
