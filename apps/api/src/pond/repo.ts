import type { Queryable } from "@kuutti/db";
import { MATCHING_OPEN_KEY, matchingOpen } from "../lib/matching-config.ts";

// Raw parameterised SQL for the same reason as identity/repo.ts: Deps.db is
// the Queryable seam the test harness hands a rolled-back transaction through.
// There is no pond's row (ADR-061 §8, #607): a home is what puts a person
// among the others, and the switch is the same for everyone. Every statement
// about a person carries the caller's account id (rule 6).

/** A home as `account` holds it: the kept place's key, and whether the card shows its area (ADR-061 §2, §3). */
export type StoredHome = { place: string | null; showsArea: boolean };

type HomeRow = {
  home_place: string | null;
  home_shows_area: boolean;
};

const storedHome = (row: HomeRow): StoredHome => ({
  place: row.home_place,
  showsArea: row.home_shows_area,
});

/** The person's own home; a tombstone holds none, and nobody else's is read here (rule 6). */
export async function findHomeOfAccount(
  db: Queryable,
  accountId: string,
): Promise<StoredHome | null> {
  const { rows } = await db.query<HomeRow>(
    "SELECT home_place, home_shows_area FROM account WHERE id = $1",
    [accountId],
  );
  return rows[0] ? storedHome(rows[0]) : null;
}

/**
 * The home, under the lock erasure takes first (ADR-009 §8): a write racing an
 * erasure lands before the tombstone, or finds it here and writes nothing.
 * Null for no live account.
 */
export async function lockHomeOfAccount(
  tx: Queryable,
  accountId: string,
): Promise<StoredHome | null> {
  const { rows } = await tx.query<HomeRow>(
    `SELECT home_place, home_shows_area FROM account
     WHERE id = $1 AND state <> 'deleted' FOR UPDATE`,
    [accountId],
  );
  return rows[0] ? storedHome(rows[0]) : null;
}

/**
 * The write of a home. `place` null leaves the kept place as it is.
 */
export async function writeHomeOfAccount(
  tx: Queryable,
  accountId: string,
  home: StoredHome,
): Promise<void> {
  await tx.query(
    `UPDATE account
        SET home_place = COALESCE($2, home_place), home_shows_area = $3
      WHERE id = $1`,
    [accountId, home.place, home.showsArea],
  );
}

/**
 * One turn of the switch at a time, across every process that may turn it: of
 * two admins pressing at once the second reads what the first wrote, so they
 * write one version and one audit row.
 */
const MATCHING_SWITCH_LOCK_KEY = 725_121_155;

/**
 * Turns the switch (ADR-060 §2): its next version in `matching_config`, by
 * whoever pressed, with no reason, since none is asked. The id of the row
 * written, which the audit row is about; null for a press that met the switch
 * as it asked, which writes nothing. Call it in a transaction: the lock is
 * held until it ends.
 */
export async function turnMatching(
  tx: Queryable,
  open: boolean,
  actor: string,
): Promise<string | null> {
  await tx.query("SELECT pg_advisory_xact_lock($1)", [MATCHING_SWITCH_LOCK_KEY]);
  if ((await matchingOpen(tx)) === open) return null;
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO matching_config (version, key, value, created_by)
     SELECT max(version) + 1, $1, $2::jsonb, $3 FROM matching_config WHERE key = $1
     RETURNING id`,
    [MATCHING_OPEN_KEY, JSON.stringify(open), actor],
  );
  return rows[0]?.id ?? null;
}
