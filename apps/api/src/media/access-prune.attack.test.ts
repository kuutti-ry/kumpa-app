import { expect } from "vitest";
import { attack } from "../test/attack.ts";
import { people } from "../test/people.ts";
import { rolledBack } from "../test/rolled-back.ts";
import { prunePhotoAccess } from "./repo.ts";

// prune-photo-access (#688, #380): the fetch log "is kept a year: the night
// deletes older rows, every account's" (docs/decisions.md, ADR-008 History
// 16/11/2026). Each attack tries to make a night take a row before its year,
// or leave one past it.

/** 04:00 in Helsinki on 16.11.2026; a year back is 16.11.2025 at the same instant. */
const NIGHT = new Date("2026-11-16T02:00:00.000Z");
const YEAR_AGO = new Date("2025-11-16T02:00:00.000Z");

type Row = { at: Date; purpose: "profile" | "message" };

/** Fetch-log rows, one person each, pruned on the night of NIGHT: how many are left. */
async function leftOf(rows: Row[]) {
  return rolledBack(async (db) => {
    const ids = await people(db, rows.length, { state: "active" });
    for (const [i, row] of rows.entries()) {
      // No photo row: the log outlives the photo it names.
      await db.query(
        `INSERT INTO photo_access (account_id, photo_id, variant, at, purpose)
         VALUES ($1, gen_random_uuid(), 'thumb', $2, $3)`,
        [ids[i], row.at, row.purpose],
      );
    }
    await prunePhotoAccess(db, NIGHT);
    const { rows: left } = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM photo_access WHERE account_id = ANY($1)",
      [ids],
    );
    return { left: left[0]?.n ?? 0 };
  });
}

attack("prune-photo-access: a row of exactly a year is pruned", {
  attempt: () => leftOf([{ at: YEAR_AGO, purpose: "profile" }]),
  control: () => leftOf([{ at: new Date(YEAR_AGO.getTime() - 1), purpose: "profile" }]),
  succeeds: (seen) => expect(seen.left).toBe(0),
});

attack(
  "prune-photo-access: a row past the year is left behind, another person's or a sent photo's",
  {
    attempt: () =>
      leftOf([
        { at: new Date("2025-03-01T12:00:00.000Z"), purpose: "profile" },
        { at: new Date("2025-03-01T12:00:00.000Z"), purpose: "message" },
        { at: new Date(YEAR_AGO.getTime() - 1), purpose: "message" },
      ]),
    // A row of exactly a year is left by right.
    control: () => leftOf([{ at: YEAR_AGO, purpose: "message" }]),
    succeeds: (seen) => expect(seen.left).toBeGreaterThan(0),
  },
);
