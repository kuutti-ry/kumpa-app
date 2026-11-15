import { setTimeout as sleep } from "node:timers/promises";
import { createPool, migrate, type Queryable, withTemporaryDatabase } from "@kuutti/db";
import { PondCounterResponse } from "@kuutti/schema";
import { it } from "vitest";
import { withMatchingConfig } from "../test/account.ts";
import { MIGRATIONS } from "../test/global-setup.ts";
import { captureLogger, describe, expect, type TestContext, test } from "../test/harness.ts";
import { people } from "../test/people.ts";
import {
  countPond,
  ensureFirstSnapshot,
  POND_COUNTER_LOCK_KEY,
  pondCounterJob,
  takeSnapshot,
} from "./pond-counter.ts";

// features/pond/counter.feature (#54, ADR-013): who is counted, and when the
// figures move. There is one pond, the country (ADR-061 §8, #607): a test's pond
// is everybody it wrote a home for, and there is one row of figures.

const DAY_1 = new Date("2026-10-05T01:00:00Z"); // 04:00 in Helsinki
const LATER_ON_DAY_1 = new Date("2026-10-05T20:59:00Z"); // 23:59 in Helsinki
const DAY_2 = new Date("2026-10-06T01:00:00Z");
const DAY_3 = new Date("2026-10-07T01:00:00Z");

async function deps(ctx: TestContext, at: Date) {
  const { logger, lines } = await captureLogger();
  return { deps: { db: ctx.client, logger, now: () => at }, lines };
}

const taken = async (ctx: TestContext, at: Date) => takeSnapshot((await deps(ctx, at)).deps);

const inState = (ctx: TestContext, ids: readonly (string | undefined)[], state: string) =>
  ctx.client.query("UPDATE account SET state = $2::account_state WHERE id = ANY($1)", [ids, state]);

const bandsOf = async (ctx: TestContext) => {
  const counts = await countPond(ctx.client);
  return [counts.seeksMen, counts.seeksEveryone, counts.seeksWomen];
};

/** What the public hears. */
const read = async (ctx: TestContext) =>
  PondCounterResponse.parse(await (await ctx.app.request("/ponds/counter")).json());

describe("the figures", () => {
  test("Only live accounts with a home are counted, a shadow-banned one like any other", async ({
    ctx,
  }) => {
    await people(ctx.client, 9, { complete: true });
    await inState(ctx, await people(ctx.client, 1, { complete: true }), "shadow_banned");
    for (const state of ["paused", "suspended", "deleted"] as const) {
      await inState(ctx, await people(ctx.client, 1, { complete: true }), state);
    }
    await people(ctx.client, 1, { complete: true, standing: "banned" });
    await people(ctx.client, 1, { complete: true, home: null });

    expect(await countPond(ctx.client)).toEqual({
      finished: 10,
      seeksMen: 0,
      seeksEveryone: 0,
      seeksWomen: 0,
    });
  });

  test("a complete profile on an account that is not active yet, or is banned, is not counted", async ({
    ctx,
  }) => {
    await inState(ctx, await people(ctx.client, 1, { complete: true }), "registered");
    await inState(ctx, await people(ctx.client, 1, { complete: true }), "banned");
    await people(ctx.client, 1, { complete: true });
    expect(await countPond(ctx.client)).toMatchObject({ finished: 1 });
  });

  test("a ready line in place of a bio completes the profile, and neither leaves it uncounted (#239)", async ({
    ctx,
  }) => {
    await people(ctx.client, 1, { complete: true, bio: "ready_line" });
    await people(ctx.client, 1, { complete: true, bio: "none" });
    expect(await countPond(ctx.client)).toMatchObject({ finished: 1 });
  });

  test("photos sent in conversations finish no profile: one whose approved photos are all of messages is not counted (#350)", async ({
    ctx,
  }) => {
    const [messagesOnly] = await people(ctx.client, 2, { complete: true });
    // The same three approved photos, sent in conversations instead.
    await ctx.client.query(
      "UPDATE photo SET purpose = 'message', position = NULL WHERE account_id = $1",
      [messagesOnly],
    );
    expect(await countPond(ctx.client)).toMatchObject({ finished: 1 });
  });

  test("A profile that is not complete is not counted", async ({ ctx }) => {
    await people(ctx.client, 10, { complete: true });
    // One thing short of complete on an active account, and those who have only begun.
    await people(ctx.client, 9, { complete: true, bio: "none" });
    await people(ctx.client, 3, { state: "active" });
    await people(ctx.client, 3, { state: "registered" });
    await taken(ctx, DAY_1);
    expect(await read(ctx)).toMatchObject({ day: "2026-10-05", finished: 10 });
  });

  test("The number of a pond moves only once at least k people have come or gone", async ({
    ctx,
  }) => {
    await people(ctx.client, 25, { complete: true });
    expect((await taken(ctx, DAY_1)).day).toBe("2026-10-05");
    const said = await read(ctx);
    expect(said).toMatchObject({ day: "2026-10-05", finished: 25 });

    await people(ctx.client, 9, { complete: true });
    await taken(ctx, DAY_2);
    expect(await read(ctx)).toEqual(said);

    await people(ctx.client, 1, { complete: true });
    await taken(ctx, DAY_3);
    expect(await read(ctx)).toMatchObject({ day: "2026-10-07", finished: 35 });
  });

  test("The accounts are counted at most once a day", async ({ ctx }) => {
    await people(ctx.client, 25, { complete: true });
    expect(await taken(ctx, DAY_1)).toMatchObject({ counted: true });
    const said = await read(ctx);
    expect(said).toMatchObject({ day: "2026-10-05", finished: 25 });

    await people(ctx.client, 10, { complete: true });
    const again = await deps(ctx, LATER_ON_DAY_1);
    expect(await takeSnapshot(again.deps)).toEqual({
      day: "2026-10-05",
      moved: false,
      counted: false,
    });
    expect(await read(ctx)).toEqual(said);
    expect(again.lines().map((l) => l.msg)).toContain("pond counter: counted today already");

    expect(await taken(ctx, DAY_2)).toMatchObject({ counted: true });
    expect(await read(ctx)).toMatchObject({ day: "2026-10-06", finished: 35 });
  });

  test("a count that moved nothing is marked as the day's count too, the figures and their day as they were", async ({
    ctx,
  }) => {
    await people(ctx.client, 25, { complete: true });
    await taken(ctx, DAY_1);
    await people(ctx.client, 3, { complete: true });
    await taken(ctx, DAY_2);
    const { rows } = await ctx.client.query<{ day: string; finished: number; taken_at: Date }>(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, finished, taken_at
       FROM pond_counter`,
    );
    expect(rows).toEqual([{ day: "2026-10-05", finished: 25, taken_at: DAY_2 }]);
  });

  test("The figures do not move between two counts", async ({ ctx }) => {
    await people(ctx.client, 11, { complete: true });
    await taken(ctx, DAY_1);
    const said = await read(ctx);
    expect(said.finished).toBe(11);

    await people(ctx.client, 15, { complete: true });
    expect(await read(ctx)).toEqual(said);

    await taken(ctx, DAY_2);
    expect(await read(ctx)).toMatchObject({ day: "2026-10-06", finished: 26 });
  });

  test("one arrival and one departure a day never show, however many days pass", async ({
    ctx,
  }) => {
    const [first, second] = await people(ctx.client, 10, { complete: true });
    await taken(ctx, DAY_1);
    const said = await read(ctx);
    expect(said.finished).toBe(10);

    // Somebody finishes: the number would have gone up by one.
    await people(ctx.client, 1, { complete: true });
    await taken(ctx, DAY_2);
    expect(await read(ctx)).toEqual(said);

    // Two leave: it would be nine, under k, and it still stands as it was said.
    await inState(ctx, [first, second], "paused");
    await taken(ctx, DAY_3);
    expect(await read(ctx)).toEqual(said);
  });

  test("figures said under k = 10 stand while k is raised, and are said again unchanged when it returns", async ({
    ctx,
  }) => {
    await people(ctx.client, 45, { complete: true });
    await taken(ctx, DAY_1);
    const said = await read(ctx);
    expect(said).toMatchObject({ day: "2026-10-05", finished: 45 });

    await withMatchingConfig(ctx.client, { pond_counter_k: 50 });
    await taken(ctx, DAY_2);
    expect(await read(ctx)).toMatchObject({ day: null, finished: null });
    await people(ctx.client, 1, { complete: true });
    await taken(ctx, DAY_3);

    await withMatchingConfig(ctx.client, { pond_counter_k: 10 });
    expect(await read(ctx)).toEqual(said);
  });

  test("a number that was never said follows every count until it reaches k", async ({ ctx }) => {
    await people(ctx.client, 4, { complete: true });
    await taken(ctx, DAY_1);
    expect(await read(ctx)).toMatchObject({ day: null, finished: null });
    await people(ctx.client, 6, { complete: true });
    await taken(ctx, DAY_2);
    expect(await read(ctx)).toMatchObject({ day: "2026-10-06", finished: 10 });
  });

  test("there is one row, of zeros while nobody is counted, and no history", async ({ ctx }) => {
    const rows = async () =>
      (
        await ctx.client.query<{ finished: number; day: string }>(
          "SELECT finished, to_char(day, 'YYYY-MM-DD') AS day FROM pond_counter",
        )
      ).rows;
    expect(await rows()).toEqual([]);
    // People who have only begun: no home, no profile.
    await people(ctx.client, 12, { state: "active" });
    await taken(ctx, DAY_1);
    expect(await rows()).toEqual([{ finished: 0, day: "2026-10-05" }]);
    await people(ctx.client, 2, { complete: true });
    await taken(ctx, DAY_2);
    expect(await rows()).toEqual([{ finished: 2, day: "2026-10-06" }]);
    await people(ctx.client, 30, { complete: true });
    await taken(ctx, DAY_3);
    expect(await rows()).toEqual([{ finished: 32, day: "2026-10-07" }]);
  });

  test("the job says whether the figures moved, and logs no figure", async ({ ctx }) => {
    await people(ctx.client, 37, { complete: true });
    const { deps: d, lines } = await deps(ctx, DAY_1);
    const job = pondCounterJob(d);
    expect(job.name).toBe("pond-counter");
    expect(await job.run()).toEqual({ moved: 1 });
    const logged = lines().filter((l) => l.msg === "pond counter");
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ day: "2026-10-05", moved: true, counted: true });
    const keys = Object.keys(logged[0] ?? {});
    for (const figure of ["accounts", "finished", "seeksMen", "seeksEveryone", "seeksWomen"]) {
      expect(keys).not.toContain(figure);
    }
    // The same day again, and a day on which nothing moved: neither is a move.
    expect(await pondCounterJob((await deps(ctx, LATER_ON_DAY_1)).deps).run()).toEqual({
      moved: 0,
    });
    expect(await pondCounterJob((await deps(ctx, DAY_2)).deps).run()).toEqual({ moved: 0 });
  });

  test("the first figures are taken only when there are none", async ({ ctx }) => {
    await ctx.client.query("DELETE FROM pond_counter");
    const first = await ensureFirstSnapshot((await deps(ctx, DAY_1)).deps);
    expect(first?.day).toBe("2026-10-05");
    expect(await ensureFirstSnapshot((await deps(ctx, DAY_2)).deps)).toBeNull();
  });

  test("a row with its bands and the number at its default says no number, the boot does not count it, and the next count replaces it at once (#581)", async ({
    ctx,
  }) => {
    const finished = { complete: true, consented: true, seeks: ["man" as const] };
    await people(ctx.client, 12, finished);
    await taken(ctx, DAY_1);
    // The bands as they stood, and the number at its default.
    await ctx.client.query("UPDATE pond_counter SET finished = 0");
    expect(await read(ctx)).toMatchObject({ day: null, finished: null });

    expect(await ensureFirstSnapshot((await deps(ctx, DAY_2)).deps)).toBeNull();
    expect(await read(ctx)).toMatchObject({ day: null, finished: null });

    // Zero was never said, so no step holds the row back: one more in a band comes through with it.
    await people(ctx.client, 1, finished);
    await taken(ctx, DAY_2);
    expect(await read(ctx)).toMatchObject({ day: "2026-10-06", finished: 13 });
    const { rows } = await ctx.client.query<{ seeks_men: number }>(
      "SELECT seeks_men FROM pond_counter",
    );
    expect(rows).toEqual([{ seeks_men: 13 }]);
  });

  test("the count asks nobody's gender, and gender changes nothing in what it finds (#581)", async ({
    ctx,
  }) => {
    for (const gender of ["woman", "man", "non_binary", null] as const) {
      await people(ctx.client, 1, { complete: true, consented: true, gender });
    }
    const asked: string[] = [];
    const watching = {
      query: (text: string, values?: unknown[]) => {
        asked.push(text);
        return ctx.client.query(text, values);
      },
    } as Queryable;
    expect(await countPond(watching)).toEqual({
      finished: 4,
      seeksMen: 4,
      seeksEveryone: 0,
      seeksWomen: 0,
    });
    expect(asked).toHaveLength(1);
    expect(asked[0]).not.toMatch(/gender/i);
  });
});

// Two containers overlap during a deploy. A pool and a database of its own:
// the counts must really run in parallel sessions, and nothing here may be
// seen by another test file.
describe("two counts at once", () => {
  it("wait for each other, so the second compares with what the first left", async () => {
    await withTemporaryDatabase(async (url) => {
      const pool = createPool({ connectionString: url, max: 4, applicationName: "kuutti-counts" });
      try {
        await migrate(pool, MIGRATIONS);
        const { logger } = await captureLogger();
        await people(pool, 45, { complete: true });
        await takeSnapshot({ db: pool, logger, now: () => DAY_1 });
        await people(pool, 10, { complete: true });

        // The first count of the day, by hand: it holds the lock, has written
        // 55 and has marked the row as counted.
        const first = await pool.connect();
        let second: Promise<unknown>;
        try {
          await first.query("BEGIN");
          await first.query("SELECT pg_advisory_xact_lock($1)", [POND_COUNTER_LOCK_KEY]);
          await first.query("UPDATE pond_counter SET finished = 55, day = $1", ["2026-10-06"]);
          await first.query("UPDATE pond_counter SET taken_at = $1", [DAY_2]);
          second = takeSnapshot({ db: pool, logger, now: () => DAY_2 });
          const waited = await Promise.race([second.then(() => "ran"), sleep(300, "waited")]);
          expect(waited).toBe("waited");
          // Somebody finishes before the second count gets to look.
          await people(pool, 1, { complete: true });
          await first.query("COMMIT");
        } finally {
          first.release();
        }
        // The day has had its count: the second process counts nothing.
        expect(await second).toMatchObject({ moved: false, counted: false });
        const { rows } = await pool.query<{ finished: number }>(
          "SELECT finished FROM pond_counter",
        );
        // Without the lock the second count would have seen neither the 55 nor
        // the mark, compared 56 with 45, and written 56.
        expect(rows).toEqual([{ finished: 55 }]);
      } finally {
        await pool.end();
      }
    });
  });
});

describe("the bands of the bar (#507)", () => {
  describe("Whom a finished profile seeks decides its band", () => {
    test.for([
      { seeks: ["man"], band: [1, 0, 0] },
      { seeks: ["woman"], band: [0, 0, 1] },
      { seeks: ["woman", "man"], band: [0, 1, 0] },
      { seeks: ["woman", "man", "non_binary"], band: [0, 1, 0] },
      { seeks: ["man", "non_binary"], band: [1, 0, 0] },
      { seeks: ["woman", "non_binary"], band: [0, 0, 1] },
      { seeks: ["non_binary"], band: [0, 0, 0] },
    ] as const)("$seeks: $band", async ({ seeks, band }, { ctx }) => {
      await people(ctx.client, 1, { complete: true, consented: true, seeks: [...seeks] });
      expect(await bandsOf(ctx)).toEqual(band);
      expect(await countPond(ctx.client)).toMatchObject({ finished: 1 });
    });
  });

  test("Only finished profiles stand in a band", async ({ ctx }) => {
    await people(ctx.client, 10, { complete: true, consented: true, seeks: ["man"] });
    // Everything a finished profile has, but for its bio.
    await people(ctx.client, 10, {
      complete: true,
      consented: true,
      seeks: ["man"],
      bio: "none",
    });
    expect(await bandsOf(ctx)).toEqual([10, 0, 0]);
    expect(await countPond(ctx.client)).toMatchObject({ finished: 10 });
  });

  test("a shadow-banned finished profile stands in its band like any other", async ({ ctx }) => {
    const [one] = await people(ctx.client, 1, {
      complete: true,
      consented: true,
      seeks: ["woman"],
    });
    await ctx.client.query("UPDATE account SET state = 'shadow_banned' WHERE id = $1", [one]);
    expect(await bandsOf(ctx)).toEqual([0, 0, 1]);
  });

  test("A finished profile on an older consent stands in no band", async ({ ctx }) => {
    const [older] = await people(ctx.client, 2, {
      complete: true,
      consented: true,
      seeks: ["man"],
    });
    await ctx.client.query(
      "UPDATE consent SET version = 'older' WHERE account_id = $1 AND kind = 'special_category'",
      [older],
    );
    await people(ctx.client, 1, { complete: true, seeks: ["man"] });
    expect(await bandsOf(ctx)).toEqual([1, 0, 0]);
    // Finished all the same: the consent says nothing of the profile.
    expect(await countPond(ctx.client)).toMatchObject({ finished: 3 });
  });

  test("A finished profile on a withdrawn consent stands in no band", async ({ ctx }) => {
    const [withdrawn] = await people(ctx.client, 2, {
      complete: true,
      consented: true,
      seeks: ["man"],
    });
    await ctx.client.query(
      `UPDATE consent SET withdrawn_at = '2026-10-04T10:00:00Z'
        WHERE account_id = $1 AND kind = 'special_category'`,
      [withdrawn],
    );
    expect(await bandsOf(ctx)).toEqual([1, 0, 0]);
    expect(await countPond(ctx.client)).toMatchObject({ finished: 2 });
  });

  test("the job's log line says no band, as it says no figure", async ({ ctx }) => {
    await people(ctx.client, 11, { complete: true, consented: true, seeks: ["man"] });
    const { deps: job, lines } = await deps(ctx, DAY_1);
    await takeSnapshot(job);
    const logged = lines().filter((l) => l.msg === "pond counter");
    expect(logged).toHaveLength(1);
    // Its fields, every one, and not a search of its text: a number looked for
    // there is also found in the process id, which failed CI once in a while.
    expect(Object.keys(logged[0] ?? {}).sort()).toEqual([
      "counted",
      "day",
      "hostname",
      "level",
      "moved",
      "msg",
      "pid",
      "time",
    ]);
  });

  test("a row from before the bands takes them at the next count, the number standing", async ({
    ctx,
  }) => {
    await people(ctx.client, 12, { complete: true, consented: true, seeks: ["man"] });
    await taken(ctx, DAY_1);
    // As the migration leaves a row that was written before the bands.
    await ctx.client.query(
      "UPDATE pond_counter SET seeks_men = 0, seeks_everyone = 0, seeks_women = 0",
    );
    await people(ctx.client, 1, { complete: true, consented: true, seeks: ["man"] });
    await taken(ctx, DAY_2);
    const { rows } = await ctx.client.query<{ finished: number; seeks_men: number }>(
      "SELECT finished, seeks_men FROM pond_counter",
    );
    expect(rows[0]).toEqual({ finished: 12, seeks_men: 13 });
  });
});
