import { expect } from "vitest";
import { attack } from "../test/attack.ts";
import { people } from "../test/people.ts";
import { rolledBack } from "../test/rolled-back.ts";
import { pruneQueueDays } from "./queue.ts";

// prune-queue-days (#502, ADR-062 §13, #380): queue days are kept a year, counted in
// Finnish days, "the night deletes queue days older than that, their entries and
// relaxations with them". Each attack tries to make a night keep a queue past
// its year, take one of exactly a year, or leave a pruned queue's rows behind.

/** 04:00 in Helsinki on 16.10.2026: a year ago is 16.10.2025. */
const NIGHT = new Date("2026-10-16T01:00:00.000Z");

/** A person's queue of `day` with one card and one relaxation, pruned at `at`: what is left of it. */
async function queueDayPruned(day: string, at: Date) {
  return rolledBack(async (db) => {
    const [owner, card] = await people(db, 2, { state: "active" });
    const { rows } = await db.query<{ id: string }>(
      "INSERT INTO queue_day (account_id, day) VALUES ($1, $2) RETURNING id",
      [owner, day],
    );
    const id = rows[0]?.id;
    await db.query(
      `INSERT INTO queue_entry (queue_day_id, position, candidate_id, reason)
       VALUES ($1, 1, $2, 'matches_filters')`,
      [id, card],
    );
    await db.query(
      "INSERT INTO queue_relaxation (queue_day_id, field, kind) VALUES ($1, 'smoking', 'aside')",
      [id],
    );
    await pruneQueueDays(db, at);
    const left = await db.query<{ days: number; rows: number }>(
      `SELECT (SELECT count(*)::int FROM queue_day WHERE id = $1) AS days,
              (SELECT count(*)::int FROM queue_entry WHERE queue_day_id = $1)
                + (SELECT count(*)::int FROM queue_relaxation WHERE queue_day_id = $1) AS rows`,
      [id],
    );
    return { kept: left.rows[0]?.days === 1, rows: left.rows[0]?.rows ?? 0 };
  });
}

attack(
  "prune-queue-days: a queue a year and a day old in Finland is kept at half past midnight there",
  {
    // 00:30 of 17.10 in Helsinki, still the 16th by the clock of Greenwich.
    attempt: () => queueDayPruned("2025-10-16", new Date("2026-10-16T21:30:00.000Z")),
    // 23:30 of 16.10 in Helsinki: the queue is a year old, no more.
    control: () => queueDayPruned("2025-10-16", new Date("2026-10-16T20:30:00.000Z")),
    succeeds: (seen) => expect(seen.kept).toBe(true),
  },
);

attack("prune-queue-days: a queue of exactly a year ago is deleted", {
  attempt: () => queueDayPruned("2025-10-16", NIGHT),
  control: () => queueDayPruned("2025-10-15", NIGHT),
  succeeds: (seen) => expect(seen.kept).toBe(false),
});

attack("prune-queue-days: a pruned queue's entries and relaxations are left behind", {
  attempt: () => queueDayPruned("2025-10-15", NIGHT),
  // A queue of exactly a year keeps its rows by right.
  control: () => queueDayPruned("2025-10-16", NIGHT),
  succeeds: (seen) => expect(seen.rows).toBeGreaterThan(0),
});
