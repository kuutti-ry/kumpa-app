import type { Queryable } from "@kuutti/db";
import { QUEUE_PAGE, QUEUE_POSITION_MAX } from "@kuutti/schema";
import { finnishDay } from "../lib/finnish-day.ts";
import { signedInAccount } from "../test/account.ts";
import { captureLogger, describe, expect, test } from "../test/harness.ts";
import { logged } from "../test/queue.ts";
import { appendRelaxed, type CardOf, readAdded, undoRelaxation } from "./queue.ts";

// The short pool's writers (#99, ADR-042 §5, §6) where the routes cannot reach
// them: a relaxation recorded or undone between the route's look and the
// write, as a second device's tap would be; a candidate who stopped being
// one meanwhile; the queue's places; a page at a time
// (ADR-062 §10). The routes are jobs/short-pool.test.ts.

const NOON = new Date("2026-10-20T09:00:00.000Z");
const DAY = finnishDay(NOON);
const ASIDE = { field: "smoking", kind: "aside" } as const;
const KIDS = { field: "hasKids", kind: "aside" } as const;

const depsOf = async (db: Queryable) => ({
  db,
  logger: (await captureLogger()).logger,
  now: () => NOON,
});

/** A's queue of today with these people in it at places 1, 2…, and nobody else. */
const queueWith = (db: Queryable, accountId: string, cards: string[]) =>
  logged(db, accountId, DAY, cards);

async function placesOf(db: Queryable, queueDayId: string) {
  const { rows } = await db.query<{ position: number; candidate_id: string; reason: string }>(
    "SELECT position, candidate_id, reason FROM queue_entry WHERE queue_day_id = $1 ORDER BY position",
    [queueDayId],
  );
  return rows;
}

/** People a relaxation lets in who need none of the day's other relaxations. */
const as = (ids: string[]) =>
  ids.map((candidateId) => ({ candidateId, needs: [], distance: "close" as const }));

describe("the relaxation's answer", () => {
  test("leaves out somebody who narrowed their filters after the pool was walked (ADR-062 §8)", async ({
    ctx,
  }) => {
    const owner = await signedInAccount(ctx.client);
    const stays = await signedInAccount(ctx.client);
    const narrowed = await signedInAccount(ctx.client);
    const deps = await depsOf(ctx.client);
    const queueDayId = await queueWith(ctx.client, owner.accountId, []);
    const placed = await appendRelaxed(deps, {
      accountId: owner.accountId,
      day: DAY,
      relaxation: ASIDE,
      basis: [],
      candidates: as([stays.accountId, narrowed.accountId]),
    });
    expect(placed).toEqual([1, 2]);
    const cards = [] as string[];
    const cardOf: CardOf = async (_viewer, subject) => {
      cards.push(subject);
      return { accountId: subject, fields: {} } as Awaited<ReturnType<CardOf>>;
    };

    const fits = { fits: async () => new Set([stays.accountId]) };
    const entries = await readAdded(deps, fits, owner.accountId, DAY, placed, cardOf, []);

    expect(entries.map((entry) => entry.position)).toEqual([1]);
    // Its card is never built, so nothing of it is shown or counted.
    expect(cards).toEqual([stays.accountId]);
    // It stays in the log, for a read once it fits again.
    expect((await placesOf(ctx.client, queueDayId)).map((place) => place.candidate_id)).toEqual([
      stays.accountId,
      narrowed.accountId,
    ]);
  });
});

describe("the relaxation's writer", () => {
  test("refuses a deal-breaker relaxed since the route looked, and adds nothing", async ({
    ctx,
  }) => {
    const a = await signedInAccount(ctx.client);
    const b = await signedInAccount(ctx.client);
    const deps = await depsOf(ctx.client);
    const queueDayId = await queueWith(ctx.client, a.accountId, []);
    expect(
      await appendRelaxed(deps, {
        accountId: a.accountId,
        day: DAY,
        relaxation: ASIDE,
        basis: [],
        candidates: as([]),
      }),
    ).toEqual([]);

    const again = appendRelaxed(deps, {
      accountId: a.accountId,
      day: DAY,
      relaxation: { ...ASIDE, kind: "unanswered" },
      basis: [],
      candidates: as([b.accountId]),
    });

    await expect(again).rejects.toMatchObject({ status: 409, code: "already_relaxed" });
    expect(await placesOf(ctx.client, queueDayId)).toEqual([]);
  });

  test("refuses a relaxation counted under other relaxations than stand now, and adds nothing", async ({
    ctx,
  }) => {
    const a = await signedInAccount(ctx.client);
    const b = await signedInAccount(ctx.client);
    const deps = await depsOf(ctx.client);
    const queueDayId = await queueWith(ctx.client, a.accountId, []);
    // Another device relaxed smoking after this tap's candidates were counted without it.
    await appendRelaxed(deps, {
      accountId: a.accountId,
      day: DAY,
      relaxation: ASIDE,
      basis: [],
      candidates: as([]),
    });

    const stale = appendRelaxed(deps, {
      accountId: a.accountId,
      day: DAY,
      relaxation: KIDS,
      basis: [],
      candidates: as([b.accountId]),
    });

    await expect(stale).rejects.toMatchObject({ status: 409, code: "relaxations_changed" });
    expect(await placesOf(ctx.client, queueDayId)).toEqual([]);
    const { rows } = await ctx.client.query(
      "SELECT field FROM queue_relaxation WHERE queue_day_id = $1",
      [queueDayId],
    );
    expect(rows).toEqual([{ field: "smoking" }]);
  });

  test("writes only who is still a candidate where it writes, at the places after the last", async ({
    ctx,
  }) => {
    const a = await signedInAccount(ctx.client);
    const [first, blocked, paused, already, live] = await Promise.all(
      Array.from({ length: 5 }, () => signedInAccount(ctx.client)),
    );
    if (!first || !blocked || !paused || !already || !live) throw new Error("not written");
    const queueDayId = await queueWith(ctx.client, a.accountId, [
      first.accountId,
      already.accountId,
    ]);
    await ctx.client.query(
      `INSERT INTO block (blocker_identity_id, blocked_identity_id)
       SELECT b.identity_id, a.identity_id FROM account a, account b WHERE a.id = $1 AND b.id = $2`,
      [a.accountId, blocked.accountId],
    );
    await ctx.client.query("UPDATE account SET state = 'paused' WHERE id = $1", [paused.accountId]);

    const placed = await appendRelaxed(await depsOf(ctx.client), {
      accountId: a.accountId,
      day: DAY,
      relaxation: ASIDE,
      basis: [],
      candidates: as([
        blocked.accountId,
        paused.accountId,
        a.accountId,
        already.accountId,
        live.accountId,
      ]),
    });

    expect(placed).toEqual([3]);
    expect(
      (await placesOf(ctx.client, queueDayId)).map((e) => [e.position, e.candidate_id]),
    ).toEqual([
      [1, first.accountId],
      [2, already.accountId],
      [3, live.accountId],
    ]);
  });

  test("adds nothing when every candidate is gone", async ({ ctx }) => {
    const a = await signedInAccount(ctx.client);
    const gone = await signedInAccount(ctx.client);
    const queueDayId = await queueWith(ctx.client, a.accountId, []);
    await ctx.client.query("UPDATE account SET state = 'deleted' WHERE id = $1", [gone.accountId]);

    const placed = await appendRelaxed(await depsOf(ctx.client), {
      accountId: a.accountId,
      day: DAY,
      relaxation: ASIDE,
      basis: [],
      candidates: as([gone.accountId]),
    });

    expect(placed).toEqual([]);
    expect(await placesOf(ctx.client, queueDayId)).toEqual([]);
  });

  test("never gives a place again that an undo freed", async ({ ctx }) => {
    const a = await signedInAccount(ctx.client);
    const [b, c, d] = await Promise.all([1, 2, 3].map(() => signedInAccount(ctx.client)));
    if (!b || !c || !d) throw new Error("not written");
    const deps = await depsOf(ctx.client);
    const queueDayId = await queueWith(ctx.client, a.accountId, [b.accountId]);
    const added = { accountId: a.accountId, day: DAY, basis: [] };
    expect(
      await appendRelaxed(deps, { ...added, relaxation: ASIDE, candidates: as([c.accountId]) }),
    ).toEqual([2]);
    expect(
      await undoRelaxation(deps, { accountId: a.accountId, day: DAY, field: "smoking" }),
    ).toEqual([2]);

    const again = await appendRelaxed(deps, {
      ...added,
      relaxation: ASIDE,
      candidates: as([d.accountId]),
    });

    expect(again).toEqual([3]);
    expect((await placesOf(ctx.client, queueDayId)).map((e) => e.position)).toEqual([1, 3]);
  });

  test("with no queue today, neither writer writes", async ({ ctx }) => {
    const a = await signedInAccount(ctx.client);
    const deps = await depsOf(ctx.client);
    await expect(
      appendRelaxed(deps, {
        accountId: a.accountId,
        day: DAY,
        relaxation: ASIDE,
        basis: [],
        candidates: as([]),
      }),
    ).rejects.toMatchObject({ status: 404, code: "not_found" });
    await expect(
      undoRelaxation(deps, { accountId: a.accountId, day: DAY, field: "smoking" }),
    ).rejects.toMatchObject({ status: 404, code: "not_found" });
    expect((await ctx.client.query("SELECT 1 FROM queue_relaxation")).rows).toEqual([]);
  });

  test("writes a page at a time, whoever comes first, however many it lets in", async ({ ctx }) => {
    const a = await signedInAccount(ctx.client);
    const many = await Promise.all(
      Array.from({ length: QUEUE_PAGE + 2 }, () => signedInAccount(ctx.client)),
    );
    const ids = many.map((person) => person.accountId);
    const queueDayId = await queueWith(ctx.client, a.accountId, []);

    const placed = await appendRelaxed(await depsOf(ctx.client), {
      accountId: a.accountId,
      day: DAY,
      relaxation: ASIDE,
      basis: [],
      candidates: as(ids),
    });

    expect(placed).toEqual(Array.from({ length: QUEUE_PAGE }, (_, index) => index + 1));
    expect((await placesOf(ctx.client, queueDayId)).map((e) => e.candidate_id)).toEqual(
      ids.slice(0, QUEUE_PAGE),
    );
  });

  test("past the column's last place it records the relaxation and adds nobody", async ({
    ctx,
  }) => {
    const a = await signedInAccount(ctx.client);
    const b = await signedInAccount(ctx.client);
    const queueDayId = await queueWith(ctx.client, a.accountId, []);
    await ctx.client.query("UPDATE queue_day SET last_position = $2 WHERE id = $1", [
      queueDayId,
      QUEUE_POSITION_MAX,
    ]);

    const placed = await appendRelaxed(await depsOf(ctx.client), {
      accountId: a.accountId,
      day: DAY,
      relaxation: ASIDE,
      basis: [],
      candidates: as([b.accountId]),
    });

    expect(placed).toEqual([]);
    expect(await placesOf(ctx.client, queueDayId)).toEqual([]);
    const { rows } = await ctx.client.query(
      "SELECT 1 FROM queue_relaxation WHERE queue_day_id = $1",
      [queueDayId],
    );
    expect(rows).toHaveLength(1);
  });

  test("the last place before the column's end is given, and no further", async ({ ctx }) => {
    const a = await signedInAccount(ctx.client);
    const [b, c] = await Promise.all([1, 2].map(() => signedInAccount(ctx.client)));
    if (!b || !c) throw new Error("not written");
    const queueDayId = await queueWith(ctx.client, a.accountId, []);
    await ctx.client.query("UPDATE queue_day SET last_position = $2 WHERE id = $1", [
      queueDayId,
      QUEUE_POSITION_MAX - 1,
    ]);

    const placed = await appendRelaxed(await depsOf(ctx.client), {
      accountId: a.accountId,
      day: DAY,
      relaxation: ASIDE,
      basis: [],
      candidates: as([b.accountId, c.accountId]),
    });

    expect(placed).toEqual([QUEUE_POSITION_MAX]);
  });

  test("an undo gives no place back, and a later relaxation goes on after the highest given", async ({
    ctx,
  }) => {
    const a = await signedInAccount(ctx.client);
    const [b, c, d] = await Promise.all([1, 2, 3].map(() => signedInAccount(ctx.client)));
    if (!b || !c || !d) throw new Error("not written");
    const deps = await depsOf(ctx.client);
    const queueDayId = await queueWith(ctx.client, a.accountId, [b.accountId]);
    const day = { accountId: a.accountId, day: DAY };
    expect(
      await appendRelaxed(deps, {
        ...day,
        relaxation: ASIDE,
        basis: [],
        candidates: as([c.accountId]),
      }),
    ).toEqual([2]);
    await undoRelaxation(deps, { ...day, field: "smoking" });

    const after = await appendRelaxed(deps, {
      ...day,
      relaxation: KIDS,
      basis: [],
      candidates: as([d.accountId]),
    });

    expect(after).toEqual([3]);
    expect((await placesOf(ctx.client, queueDayId)).map((e) => e.candidate_id)).toEqual([
      b.accountId,
      d.accountId,
    ]);
  });

  test("undoing one relaxation takes back only the cards that need it", async ({ ctx }) => {
    const a = await signedInAccount(ctx.client);
    const [b, c, d] = await Promise.all([1, 2, 3].map(() => signedInAccount(ctx.client)));
    if (!b || !c || !d) throw new Error("not written");
    const deps = await depsOf(ctx.client);
    const queueDayId = await queueWith(ctx.client, a.accountId, []);
    const day = { accountId: a.accountId, day: DAY };
    await appendRelaxed(deps, {
      ...day,
      relaxation: ASIDE,
      basis: [],
      candidates: as([b.accountId]),
    });
    // On top of smoking: C needs both, D only kids.
    await appendRelaxed(deps, {
      ...day,
      relaxation: KIDS,
      basis: [ASIDE],
      candidates: [
        { candidateId: c.accountId, needs: ["smoking"], distance: "close" },
        { candidateId: d.accountId, needs: [], distance: "close" },
      ],
    });

    const removed = await undoRelaxation(deps, { ...day, field: "smoking" });

    expect(removed).toEqual([1, 2]);
    expect((await placesOf(ctx.client, queueDayId)).map((e) => e.candidate_id)).toEqual([
      d.accountId,
    ]);
  });
});
