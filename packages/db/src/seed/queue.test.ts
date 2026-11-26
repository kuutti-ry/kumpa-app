import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { migrate } from "../migrate.ts";
import { createPool, type Queryable } from "../pool.ts";
import { withTemporaryDatabase } from "../test/temporary-database.ts";
import { PERSONA_HISTORIES } from "./histories.ts";
import { PERSONA_QUEUE_DAYS, writeLaterLists, writeQueueDays, writeWaitingLikes } from "./queue.ts";

// The queue of the stories (#379): Henna's like of Iida on the day before, and
// the ponds the demo commands open. Whether the cast pass each other's filters is the
// API's rule, tested beside it (apps/api/scripts/demo/demo-conversations.test.ts).

const MIGRATIONS = resolve(import.meta.dirname, "../..", "drizzle");

describe("the queue of the stories", () => {
  it("is of a persona whose story leaves her active, liked by others whose stories do too", () => {
    const active = new Set(
      PERSONA_HISTORIES.filter((h) => h.onboarding && h.profile && h.afterwards === "nothing").map(
        (h) => h.key,
      ),
    );
    for (const story of PERSONA_QUEUE_DAYS) {
      expect(active.has(story.of), story.of).toBe(true);
      expect(story.likedBy.length).toBeGreaterThan(0);
      for (const key of story.likedBy) {
        expect(active.has(key), key).toBe(true);
        expect(key).not.toBe(story.of);
      }
    }
  });
});

describe("writing the queue of the stories", () => {
  const account = async (db: Queryable, hash: string) => {
    const identity = await db.query<{ id: string }>(
      "INSERT INTO identity (hetu_hmac, broker_subject) VALUES ($1, $1) RETURNING id",
      [hash],
    );
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO account (identity_id, state, birth_year, birth_month)
       VALUES ($1, 'active', 1990, 1) RETURNING id`,
      [identity.rows[0]?.id],
    );
    return rows[0]?.id as string;
  };

  it("writes the like of the day before once, and says who is missing", async () => {
    await withTemporaryDatabase(async (url) => {
      const pool = createPool({ connectionString: url, max: 2 });
      try {
        await migrate(pool, MIGRATIONS);
        const iida = await account(pool, "hash-iida");
        const henna = await account(pool, "hash-henna");
        const accounts = new Map([
          ["iida", iida],
          ["henna", henna],
        ]);
        // 00:30 in Finland on 21.10.2026 (summer time ends on the 25th): the day before is the 20th.
        const now = new Date("2026-10-20T21:30:00Z");

        expect(await writeQueueDays(pool, accounts, now)).toEqual({
          liked: 1,
          already: 0,
          missing: 0,
        });
        const likes = await pool.query(
          `SELECT r.account_id, r.day::text AS day, e.position, e.candidate_id, e.reason, e.decision,
                  e.decided_at, e.seen_at, e.fish
             FROM queue_day r JOIN queue_entry e ON e.queue_day_id = r.id`,
        );
        const midday = new Date("2026-10-20T10:00:00Z");
        expect(likes.rows).toEqual([
          {
            account_id: henna,
            day: "2026-10-20",
            position: 1,
            candidate_id: iida,
            reason: "matches_filters",
            decision: "like",
            decided_at: midday,
            seen_at: midday,
            fish: false,
          },
        ]);

        // Again, as staging's job runs without a reset: nothing new.
        expect(await writeQueueDays(pool, accounts, new Date("2026-10-20T22:00:00Z"))).toEqual({
          liked: 0,
          already: 1,
          missing: 0,
        });

        // Nobody to like for: no account this time.
        expect(await writeQueueDays(pool, new Map(), now)).toEqual({
          liked: 0,
          already: 0,
          missing: 1,
        });
        expect(await writeQueueDays(pool, new Map([["iida", iida]]), now)).toEqual({
          liked: 0,
          already: 0,
          missing: 1,
        });
      } finally {
        await pool.end();
      }
    });
  });

  it("writes likes and fish of one person on several, in one queue of the day before, each once", async () => {
    await withTemporaryDatabase(async (url) => {
      const pool = createPool({ connectionString: url, max: 2 });
      try {
        await migrate(pool, MIGRATIONS);
        const sanna = await account(pool, "hash-sanna");
        const noa = await account(pool, "hash-noa");
        const jere = await account(pool, "hash-jere");
        const risto = await account(pool, "hash-risto");
        const accounts = new Map([
          ["sanna", sanna],
          ["noa", noa],
          ["jere", jere],
          ["risto", risto],
        ]);
        const stories = [
          { of: "sanna", fishFrom: ["jere"], likedBy: ["risto"] },
          { of: "noa", fishFrom: [], likedBy: ["jere"] },
        ];
        const now = new Date("2026-10-20T21:30:00Z");

        expect(await writeWaitingLikes(pool, stories, accounts, now)).toEqual({
          liked: 3,
          already: 0,
          missing: 0,
        });
        const midday = new Date("2026-10-20T10:00:00Z");
        const likes = await pool.query(
          `SELECT r.account_id, r.day::text AS day, e.position, e.candidate_id, e.decision, e.decided_at, e.fish
             FROM queue_day r JOIN queue_entry e ON e.queue_day_id = r.id
            ORDER BY e.fish DESC, r.account_id = $1 DESC, e.position`,
          [jere],
        );
        const row = (of: string, by: string, position: number, fish: boolean) => ({
          account_id: by,
          day: "2026-10-20",
          position,
          candidate_id: of,
          decision: "like",
          decided_at: midday,
          fish,
        });
        expect(likes.rows).toEqual([
          row(sanna, jere, 1, true),
          row(noa, jere, 2, false),
          row(sanna, risto, 1, false),
        ]);
        const rounds = await pool.query("SELECT count(*)::int AS n FROM queue_day");
        expect(rounds.rows).toEqual([{ n: 2 }]);

        // Again on the same day: nothing new.
        expect(await writeWaitingLikes(pool, stories, accounts, now)).toEqual({
          liked: 0,
          already: 3,
          missing: 0,
        });

        // Somebody has no account this time, on either side: each like that needs them is missing.
        const noJere = new Map([
          ["sanna", sanna],
          ["noa", noa],
          ["risto", risto],
        ]);
        expect(await writeWaitingLikes(pool, stories, noJere, now)).toEqual({
          liked: 0,
          already: 1,
          missing: 2,
        });
        expect(await writeWaitingLikes(pool, stories, new Map([["jere", jere]]), now)).toEqual({
          liked: 0,
          already: 0,
          missing: 3,
        });
      } finally {
        await pool.end();
      }
    });
  });

  it("puts people on a Later list the day before, the latest named first, with the photos a star shows, each once", async () => {
    await withTemporaryDatabase(async (url) => {
      const pool = createPool({ connectionString: url, max: 2 });
      try {
        await migrate(pool, MIGRATIONS);
        const sanna = await account(pool, "hash-sanna");
        const kalle = await account(pool, "hash-kalle");
        const minh = await account(pool, "hash-minh");
        const accounts = new Map([
          ["sanna", sanna],
          ["kalle", kalle],
          ["minh", minh],
        ]);
        const photo = (of: string, key: string, state: string, position: number | null) =>
          pool.query(
            `INSERT INTO photo (account_id, key, blurhash, width, height, state, position, purpose)
             VALUES ($1, $2, 'L', 800, 1067, $3, $4, $5)`,
            [of, key, state, position, position === null ? "message" : "profile"],
          );
        // A card shows the approved profile photos: neither a rejected one nor one sent in a chat.
        await photo(kalle, "kalle-main", "approved", 0);
        await photo(kalle, "kalle-second", "approved", 1);
        await photo(kalle, "kalle-rejected", "rejected", 2);
        await photo(minh, "minh-main", "approved", 0);
        await photo(minh, "minh-sent", "approved", null);
        const lists = [{ of: "sanna", later: ["kalle", "minh"] }];
        // 00:30 in Finland on 21.10.2026: the day before is the 20th, its midday 10:00 UTC.
        const now = new Date("2026-10-20T21:30:00Z");
        const kalleAt = new Date("2026-10-20T10:02:00Z");
        const minhAt = new Date("2026-10-20T10:01:00Z");

        expect(await writeLaterLists(pool, lists, accounts, now)).toEqual({
          listed: 2,
          already: 0,
          missing: 0,
        });
        const entries = async () =>
          (
            await pool.query(
              `SELECT r.account_id, r.day::text AS day, e.position, e.candidate_id, e.reason,
                      e.seen_at, e.decision, e.decided_at
                 FROM queue_day r JOIN queue_entry e ON e.queue_day_id = r.id ORDER BY e.position`,
            )
          ).rows;
        const entry = (candidate: string, position: number, at: Date) => ({
          account_id: sanna,
          day: "2026-10-20",
          position,
          candidate_id: candidate,
          reason: "matches_filters",
          seen_at: at,
          decision: "skip",
          decided_at: at,
        });
        expect(await entries()).toEqual([entry(kalle, 1, kalleAt), entry(minh, 2, minhAt)]);
        const stars = async () =>
          (
            await pool.query(
              "SELECT account_id, candidate_id, created_at FROM star ORDER BY created_at DESC",
            )
          ).rows;
        expect(await stars()).toEqual([
          { account_id: sanna, candidate_id: kalle, created_at: kalleAt },
          { account_id: sanna, candidate_id: minh, created_at: minhAt },
        ]);
        const shown = async () =>
          (
            await pool.query(
              `SELECT s.account_id, p.key, s.at FROM card_shown s JOIN photo p ON p.id = s.photo_id
                ORDER BY p.key`,
            )
          ).rows;
        expect(await shown()).toEqual([
          { account_id: sanna, key: "kalle-main", at: kalleAt },
          { account_id: sanna, key: "kalle-second", at: kalleAt },
          { account_id: sanna, key: "minh-main", at: minhAt },
        ]);

        // Again on the same day: nothing new.
        expect(await writeLaterLists(pool, lists, accounts, now)).toEqual({
          listed: 0,
          already: 2,
          missing: 0,
        });
        expect(await entries()).toHaveLength(2);
        expect(await stars()).toHaveLength(2);
        expect(await shown()).toHaveLength(3);

        // Somebody has no account this time, on either side: each star that needs them is missing.
        const noMinh = new Map([
          ["sanna", sanna],
          ["kalle", kalle],
        ]);
        expect(await writeLaterLists(pool, lists, noMinh, now)).toEqual({
          listed: 0,
          already: 1,
          missing: 1,
        });
        const noSanna = new Map([
          ["kalle", kalle],
          ["minh", minh],
        ]);
        expect(await writeLaterLists(pool, lists, noSanna, now)).toEqual({
          listed: 0,
          already: 0,
          missing: 2,
        });
      } finally {
        await pool.end();
      }
    });
  });

  it("takes the day before by the calendar", async () => {
    await withTemporaryDatabase(async (url) => {
      const pool = createPool({ connectionString: url, max: 2 });
      try {
        await migrate(pool, MIGRATIONS);
        const iida = await account(pool, "hash-iida");
        const henna = await account(pool, "hash-henna");
        const result = await writeQueueDays(
          pool,
          new Map([
            ["iida", iida],
            ["henna", henna],
          ]),
          // 00:30 in Finland on 30.3.2026: 24 hours back is still the 28th.
          new Date("2026-03-29T21:30:00Z"),
        );
        expect(result).toEqual({ liked: 1, already: 0, missing: 0 });
        // The day before is the 29th by the calendar, a day of 23 hours (summer time began on it).
        const day = await pool.query("SELECT day::text AS day FROM queue_day");
        expect(day.rows).toEqual([{ day: "2026-03-29" }]);
      } finally {
        await pool.end();
      }
    });
  });
});
