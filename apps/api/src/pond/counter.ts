import type { Queryable } from "@kuutti/db";
import {
  type PondCounterCounts,
  type PondCounterResponse,
  pondCounterK,
  publishCounts,
  seeksShares,
} from "@kuutti/schema";
import { matchingConfigNumber } from "../lib/matching-config.ts";

/**
 * The pond counter's read (#54, ADR-013): the figures it stands on, and its
 * number through `publishCounts`, which says it only where at least k people
 * stand behind it. There is one pond, the country, so there is one row and one
 * number (ADR-061 §8, #607). The figures are written by the nightly job in
 * `jobs/pond-counter.ts`, which is where the accounts are counted; the one
 * person's row read here is the caller's own, for the bar.
 *
 * Raw parameterised SQL for the same reason as pond/repo.ts: Deps.db is the
 * Queryable seam the test harness hands a rolled-back transaction through.
 * The public figures are an aggregate, the same for every reader, so there is
 * no caller to scope them by (rule 6 is about a session's own rows). The bar
 * is not the same for every reader, and its one read is scoped.
 */
const POND_COUNTER_K_KEY = "pond_counter_k";

/** The threshold in force: `matching_config.pond_counter_k`, never below the floor of packages/schema. */
export async function readPondCounterK(db: Queryable): Promise<number> {
  return pondCounterK(await matchingConfigNumber(db, POND_COUNTER_K_KEY));
}

type FiguresRow = {
  day: string;
  finished: number;
  seeks_men: number;
  seeks_everyone: number;
  seeks_women: number;
};

export type StandingFigures = { day: string; counts: PondCounterCounts };

/**
 * The figures the counter stands on, exact: for the job that moves them and
 * the read that publishes them. Null before the first count.
 */
export async function readStandingFigures(db: Queryable): Promise<StandingFigures | null> {
  const { rows } = await db.query<FiguresRow>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, finished,
            seeks_men, seeks_everyone, seeks_women
     FROM pond_counter`,
  );
  const row = rows[0];
  if (!row) return null;
  return {
    day: row.day,
    counts: {
      finished: row.finished,
      seeksMen: row.seeks_men,
      seeksEveryone: row.seeks_everyone,
      seeksWomen: row.seeks_women,
    },
  };
}

/**
 * Whether the caller hears whom people seek (#507, ADR-013 §12, §18): somebody
 * who has told their home, which is what puts a person among the others
 * (ADR-061 §8). Scoped by the caller in the query.
 */
async function hearsBar(db: Queryable, accountId: string): Promise<boolean> {
  const { rows } = await db.query(
    "SELECT 1 FROM account WHERE id = $1 AND home_place IS NOT NULL",
    [accountId],
  );
  return rows.length === 1;
}

/**
 * What may be said of the people on Kuutti, and with a caller who has told
 * their home the bar as well (ADR-013 §18): shares only, null until every band
 * is at least k, so a read with no caller carries no band at all.
 */
export async function readPondCounter(
  db: Queryable,
  accountId?: string,
): Promise<PondCounterResponse> {
  const k = await readPondCounterK(db);
  // Before the first count there is no row yet: answered with no number.
  const figures = await readStandingFigures(db);
  const finished = publishCounts(figures?.counts ?? null, k);
  const hears = accountId !== undefined && (await hearsBar(db, accountId));
  return {
    k,
    // No number, no day: when it was last counted is nobody's business while it is small.
    day: finished === null ? null : (figures?.day ?? null),
    finished,
    seeks: hears ? seeksShares(figures?.counts ?? null, k) : null,
  };
}
