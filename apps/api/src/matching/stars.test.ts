import type { Queryable } from "@kuutti/db";
import { QueueDecisionAnswer, QueueResponse, STARS_CEILING, StarList } from "@kuutti/schema";
import { type App, createApp } from "../app.ts";
import { eraseAccount, exportAccount } from "../identity/index.ts";
import { starPlace } from "../jobs/stars.ts";
import { finnishDay } from "../lib/finnish-day.ts";
import { openMatchingHere, signInAs, withMatchingConfig } from "../test/account.ts";
import { errorCode } from "../test/answers.ts";
import { cardShown } from "../test/cards.ts";
import {
  captureLogger,
  describe,
  englishT,
  expect,
  type TestContext,
  test,
  testConfig,
} from "../test/harness.ts";
import { people } from "../test/people.ts";
import { block, FITTING, type LoggedCard, logged, shownAt } from "../test/queue.ts";
import { pidOf, waitsFor, watched, withTwoConnections } from "../test/races.ts";

// The stars (#575, ADR-064, features/matching/stars.feature): a star on a card, the
// queue leaving a starred person out, the list and whoever it leaves out, a card
// opened from it, a like or a pass taking the star off, the caller's own stars
// only, erasure of both sides and the export. Matching is open for everybody here,
// and each of a test's people fits the others.

/** Noon in Helsinki on a Tuesday. */
const NOON = new Date("2026-10-20T09:00:00.000Z");
const TODAY = finnishDay(NOON);
const DAY_MS = 24 * 3600 * 1000;
const YESTERDAY_NOON = new Date(NOON.getTime() - DAY_MS);
const YESTERDAY = finnishDay(YESTERDAY_NOON);
const TOMORROW_NOON = new Date(NOON.getTime() + DAY_MS);

type Person = { accountId: string; headers: { authorization: string } };

/** A clock a second later at each reading, from `from`. */
function ticking(from = NOON): () => Date {
  let t = from.getTime();
  return () => {
    t += 1000;
    return new Date(t);
  };
}

async function appOn(db: Queryable, now: () => Date = ticking()): Promise<App> {
  const { logger } = await captureLogger();
  return createApp({ config: testConfig(), logger, db, now });
}

/** `count` people who fit each other, with matching open, each signed in. */
async function cast(db: Queryable, count: number): Promise<Person[]> {
  await openMatchingHere(db);
  const ids = await people(db, count, FITTING);
  return Promise.all(ids.map((id) => signInAs(db, id)));
}

/** What every test needs at least: `count` people and an app. */
async function scene(ctx: TestContext, count: number): Promise<{ app: App; who: Person[] }> {
  return { app: await appOn(ctx.client), who: await cast(ctx.client, count) };
}

const person = (who: readonly Person[], index: number): Person => {
  const found = who[index];
  if (!found) throw new Error("cast not written");
  return found;
};

const clear = (app: App, who: Person, id: string) =>
  app.request(`/stars/${id}`, { method: "DELETE", headers: who.headers });

const open = (app: App, who: Person, id: string) =>
  app.request(`/stars/${id}/open`, { method: "POST", headers: who.headers });

async function opened(app: App, who: Person, id: string): Promise<QueueResponse> {
  const answer = await open(app, who, id);
  expect(answer.status).toBe(200);
  return QueueResponse.parse(await answer.json());
}

async function listOf(app: App, who: Person) {
  const answer = await app.request("/stars", { headers: who.headers });
  expect(answer.status).toBe(200);
  return StarList.parse(await answer.json()).items;
}

async function readToday(app: App, who: Person): Promise<QueueResponse> {
  const answer = await app.request("/queue/today", { headers: who.headers });
  expect(answer.status).toBe(200);
  return QueueResponse.parse(await answer.json());
}

const decide = (app: App, who: Person, day: string, position: number, decision: string) =>
  app.request(`/queue/${day}/entries/${position}/decision`, {
    method: "PUT",
    headers: { ...who.headers, "content-type": "application/json" },
    body: JSON.stringify({ decision }),
  });

/** Later on the card at `position` (#681): the skip, which puts the person on the list. */
async function later(
  app: App,
  who: Person,
  position: number,
  day = TODAY,
): Promise<QueueDecisionAnswer> {
  const answer = await decide(app, who, day, position, "skip");
  expect(answer.status).toBe(200);
  return QueueDecisionAnswer.parse(await answer.json());
}

/** Whose cards `who` is shown, in order. */
const cardsOf = (read: QueueResponse) => (read.entries ?? []).map((e) => e.card.accountId);

/** The id of `owner`'s star on `candidate`, the one the list and its routes name. */
async function starOf(db: Queryable, owner: Person, candidate: Person): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "SELECT id FROM star WHERE account_id = $1 AND candidate_id = $2",
    [owner.accountId, candidate.accountId],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("no star");
  return id;
}

/** The stars `who` holds, by the ones they are on. */
async function starsOf(db: Queryable, who: Person): Promise<string[]> {
  const { rows } = await db.query<{ candidate_id: string }>(
    "SELECT candidate_id FROM star WHERE account_id = $1 ORDER BY candidate_id",
    [who.accountId],
  );
  return rows.map((row) => row.candidate_id);
}

/** These cards in `owner`'s log of today, at the next places, each served as a read serves one. */
async function queued(db: Queryable, owner: Person, cards: readonly LoggedCard[]) {
  await logged(db, owner.accountId, TODAY, cards);
  for (const card of cards) {
    const candidate = typeof card === "string" ? card : card.candidateId;
    await cardShown(db, owner.accountId, candidate, NOON);
  }
}

/** The statements a read of the list runs, in order, each with its parameters taken out. */
async function statementsOfList(db: Queryable, who: Person): Promise<string[]> {
  const statements: string[] = [];
  const counting: Queryable = {
    query: (text, values) => {
      statements.push(text.replace(/\s+/g, " ").trim());
      return db.query(text, values) as never;
    },
  };
  const answer = await (await appOn(counting)).request("/stars", { headers: who.headers });
  expect(answer.status).toBe(200);
  return statements;
}

/** `owner` was shown `candidate`'s card yesterday, left it undecided and left a star on it; the star's id. */
async function starredYesterday(db: Queryable, owner: Person, candidate: Person): Promise<string> {
  await shownAt(db, YESTERDAY_NOON, owner.accountId, candidate.accountId, null);
  const { rows } = await db.query<{ id: string }>(
    "INSERT INTO star (account_id, candidate_id, created_at) VALUES ($1, $2, $3) RETURNING id",
    [owner.accountId, candidate.accountId, YESTERDAY_NOON],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("star not written");
  return id;
}

/** `who`'s like or fish of `on`, of yesterday, waits on them. */
const likedYesterday = (db: Queryable, who: Person, on: Person, fish = false) =>
  shownAt(db, YESTERDAY_NOON, who.accountId, on.accountId, "like", { fish });

const setAges = (db: Queryable, who: Person, ages: { min: number; max: number }) =>
  db.query(
    "UPDATE preferences SET value = $2::jsonb WHERE account_id = $1 AND field = 'age_window'",
    [who.accountId, JSON.stringify(ages)],
  );

const setSeeks = (db: Queryable, who: Person, seeks: string[]) =>
  db.query("UPDATE preferences SET value = $2::jsonb WHERE account_id = $1 AND field = 'seeks'", [
    who.accountId,
    JSON.stringify(seeks),
  ]);

const setState = (db: Queryable, who: Person, state: string) =>
  db.query("UPDATE account SET state = $2::account_state WHERE id = $1", [who.accountId, state]);

const setPhotos = (db: Queryable, who: Person, state: string) =>
  db.query("UPDATE photo SET state = $2::photo_state WHERE account_id = $1", [
    who.accountId,
    state,
  ]);

describe("Later and the list", () => {
  test("Later spends nothing and puts the person on the list", async ({ ctx }) => {
    const { app, who } = await scene(ctx, 3);
    const [a, b, c] = [person(who, 0), person(who, 1), person(who, 2)];
    await queued(ctx.client, a, [b.accountId, c.accountId]);
    await withMatchingConfig(ctx.client, { like_budget_balanced: 0 });

    expect((await later(app, a, 1)).later).toBe("first");

    const next = await readToday(app, a);
    expect(cardsOf(next)).toEqual([c.accountId]);
    expect(next.likesLeft).toBe(0);
    expect(await starsOf(ctx.client, a)).toEqual([b.accountId]);
    expect((await listOf(app, a)).map((item) => item.id)).toEqual([await starOf(ctx.client, a, b)]);
    // Nothing was spent: the same day's likes, when there are some, are all there.
    await withMatchingConfig(ctx.client, { like_budget_balanced: 3 });
    expect((await readToday(app, a)).likesLeft).toBe(3);
  });

  test("Nobody is told of a Later", async ({ ctx }) => {
    const { app, who } = await scene(ctx, 2);
    const [a, b] = [person(who, 0), person(who, 1)];
    await queued(ctx.client, a, [b.accountId]);
    const before = await readToday(app, b);

    await later(app, a, 1);

    const after = await readToday(app, b);
    expect(after).toEqual(before);
    expect(after.entries?.every((entry) => entry.star === null)).toBe(true);
  });

  test("A Later counts for nothing in the inbox stop", async ({ ctx }) => {
    const { app, who } = await scene(ctx, 4);
    const [a, b, c, liker] = [person(who, 0), person(who, 1), person(who, 2), person(who, 3)];
    await withMatchingConfig(ctx.client, { inbox_stop: 2 });
    await likedYesterday(ctx.client, liker, b);
    await queued(ctx.client, a, [b.accountId]);

    await later(app, a, 1);

    expect(cardsOf(await readToday(app, c))).toContain(b.accountId);
  });

  test("Later again keeps the one place on the list", async ({ ctx }) => {
    const { app, who } = await scene(ctx, 2);
    const [a, b] = [person(who, 0), person(who, 1)];
    await queued(ctx.client, a, [b.accountId]);
    await later(app, a, 1);
    const id = await starOf(ctx.client, a, b);

    expect((await later(app, a, 1)).later).toBe("listed");

    expect(await starsOf(ctx.client, a)).toEqual([b.accountId]);
    expect(await starOf(ctx.client, a, b)).toBe(id);
  });

  test("Later again after the star was cleared puts the person back on the list", async ({
    ctx,
  }) => {
    const { app, who } = await scene(ctx, 2);
    const [a, b] = [person(who, 0), person(who, 1)];
    await queued(ctx.client, a, [b.accountId]);
    await later(app, a, 1);
    expect((await clear(app, a, await starOf(ctx.client, a, b))).status).toBe(204);

    // The same decision again, as after Undo: the skip stands, and the star comes back.
    expect((await later(app, a, 1)).later).toBe("first");

    expect(await starsOf(ctx.client, a)).toEqual([b.accountId]);
  });

  test("The first Later says the list holds only that person", async ({ ctx }) => {
    const { app, who } = await scene(ctx, 3);
    const [a, b, c] = [person(who, 0), person(who, 1), person(who, 2)];
    await queued(ctx.client, a, [b.accountId, c.accountId]);

    expect((await later(app, a, 1)).later).toBe("first");
    expect((await later(app, a, 2)).later).toBe("listed");
  });

  describe("A like or a pass takes the person off the list, and Later keeps them on", () => {
    test.for([
      { choice: "like", on: false },
      { choice: "fish", on: false },
      { choice: "pass", on: false },
      { choice: "skip", on: true },
    ])("$choice", async ({ choice, on }, { ctx }) => {
      const { app, who } = await scene(ctx, 2);
      const [a, b] = [person(who, 0), person(who, 1)];
      await queued(ctx.client, a, [b.accountId]);
      await later(app, a, 1);

      const answer = await decide(app, a, TODAY, 1, choice);

      expect(answer.status).toBe(200);
      // Only a Later says where it left the person.
      expect(QueueDecisionAnswer.parse(await answer.json()).later).toBe(on ? "listed" : null);
      expect(await starsOf(ctx.client, a)).toEqual(on ? [b.accountId] : []);
    });
  });

  test("A like refused leaves the star on", async ({ ctx }) => {
    const { app, who } = await scene(ctx, 2);
    const [a, b] = [person(who, 0), person(who, 1)];
    await queued(ctx.client, a, [b.accountId]);
    await later(app, a, 1);
    await withMatchingConfig(ctx.client, { like_budget_balanced: 0 });

    const answer = await decide(app, a, TODAY, 1, "like");

    expect(answer.status).toBe(429);
    expect(await starsOf(ctx.client, a)).toEqual([b.accountId]);
  });

  test("Later on a card liked or passed today puts the person on the list", async ({ ctx }) => {
    const { app, who } = await scene(ctx, 3);
    const [a, b, c] = [person(who, 0), person(who, 1), person(who, 2)];
    await queued(ctx.client, a, [b.accountId, c.accountId]);
    await withMatchingConfig(ctx.client, { like_budget_balanced: 1 });
    expect((await decide(app, a, TODAY, 1, "like")).status).toBe(200);
    expect((await decide(app, a, TODAY, 2, "pass")).status).toBe(200);

    const fromLike = await later(app, a, 1);
    const fromPass = await later(app, a, 2);

    expect([fromLike.later, fromPass.later]).toEqual(["first", "listed"]);
    expect(await starsOf(ctx.client, a)).toEqual([b.accountId, c.accountId].sort());
    // The like was taken back: its place in the day's likes is there again.
    expect(fromLike.likesLeft).toBe(1);
  });

  test("Later on a card of a day that has ended puts nobody on the list", async ({ ctx }) => {
    const { app, who } = await scene(ctx, 2);
    const [a, b] = [person(who, 0), person(who, 1)];
    await logged(ctx.client, a.accountId, YESTERDAY, [b.accountId]);
    await cardShown(ctx.client, a.accountId, b.accountId, YESTERDAY_NOON);

    const answer = await decide(app, a, YESTERDAY, 1, "skip");

    expect(answer.status).toBe(409);
    expect(await errorCode(answer)).toBe("day_ended");
    expect(await starsOf(ctx.client, a)).toEqual([]);
  });

  test("Later on another person's card puts nobody on the list", async ({ ctx }) => {
    const { app, who } = await scene(ctx, 3);
    const [a, b, c] = [person(who, 0), person(who, 1), person(who, 2)];
    await queued(ctx.client, a, [b.accountId]);

    const answer = await decide(app, c, TODAY, 1, "skip");

    expect(answer.status).toBe(404);
    expect(await starsOf(ctx.client, c)).toEqual([]);
    expect(await starsOf(ctx.client, a)).toEqual([]);
  });

  test("Later on a card that can no longer be shown puts nobody on the list", async ({ ctx }) => {
    const { app, who } = await scene(ctx, 3);
    const [a, b, c] = [person(who, 0), person(who, 1), person(who, 2)];
    await queued(ctx.client, a, [b.accountId, c.accountId]);
    await block(ctx.client, a, b);
    await setState(ctx.client, c, "suspended");

    for (const position of [1, 2]) {
      const answer = await decide(app, a, TODAY, position, "skip");
      expect(answer.status).toBe(404);
    }
    expect(await starsOf(ctx.client, a)).toEqual([]);
  });

  test("Later on a card never served puts nobody on the list", async ({ ctx }) => {
    const { app, who } = await scene(ctx, 2);
    const [a, b] = [person(who, 0), person(who, 1)];
    // In the log but never handed over, as past a day's budget of cards where the panel sets one.
    await logged(ctx.client, a.accountId, TODAY, [b.accountId]);

    // The skip stands; the list would say a name and an age nobody was shown (ADR-008).
    expect((await later(app, a, 1)).later).toBe("not_listed");

    expect(await starsOf(ctx.client, a)).toEqual([]);
  });
});

describe("the list's most", () => {
  test("At the most the list may hold, Later says it is full and the card comes back another day", async ({
    ctx,
  }) => {
    const { app, who } = await scene(ctx, 4);
    const [a, b, c, d] = [person(who, 0), person(who, 1), person(who, 2), person(who, 3)];
    await withMatchingConfig(ctx.client, { stars_max: 2 });
    await queued(ctx.client, a, [b.accountId, c.accountId, d.accountId]);
    await later(app, a, 1);
    await later(app, a, 2);

    expect((await later(app, a, 3)).later).toBe("full");

    expect(await starsOf(ctx.client, a)).toEqual([b.accountId, c.accountId].sort());
    // A skip all the same: back the next day as somebody seen before, where those on the list are not.
    const tomorrow = await readToday(await appOn(ctx.client, ticking(TOMORROW_NOON)), a);
    expect(cardsOf(tomorrow)).toEqual([d.accountId]);
    expect(tomorrow.entries?.[0]?.reason).toBe("seen_before");
  });

  test("One under the most the list may hold, Later still puts the person on it", async ({
    ctx,
  }) => {
    const { app, who } = await scene(ctx, 3);
    const [a, b, c] = [person(who, 0), person(who, 1), person(who, 2)];
    await withMatchingConfig(ctx.client, { stars_max: 2 });
    await queued(ctx.client, a, [b.accountId, c.accountId]);
    await later(app, a, 1);

    expect((await later(app, a, 2)).later).toBe("listed");

    expect((await starsOf(ctx.client, a)).length).toBe(2);
  });

  test("The cap of zero is off, and the contract's ceiling stands", async ({ ctx }) => {
    const { app, who } = await scene(ctx, 3);
    const [a, b, c] = [person(who, 0), person(who, 1), person(who, 2)];
    await withMatchingConfig(ctx.client, { stars_max: 0 });
    await queued(ctx.client, a, [b.accountId, c.accountId]);
    // All but one of the ceiling, on people the list leaves out: no profile, so quick to write.
    const others = await people(ctx.client, STARS_CEILING - 1);
    await ctx.client.query(
      "INSERT INTO star (account_id, candidate_id) SELECT $1, unnest($2::uuid[])",
      [a.accountId, others],
    );

    // Off: nothing stops the star that reaches the ceiling, and the list shows nobody yet.
    expect((await later(app, a, 1)).later).toBe("first");
    expect((await later(app, a, 2)).later).toBe("full");

    expect((await starsOf(ctx.client, a)).length).toBe(STARS_CEILING);
  });

  test("Somebody left out of the list does not count towards the cap", async ({ ctx }) => {
    const { app, who } = await scene(ctx, 4);
    const [a, b, c, d] = [person(who, 0), person(who, 1), person(who, 2), person(who, 3)];
    await withMatchingConfig(ctx.client, { stars_max: 2 });
    await queued(ctx.client, a, [b.accountId, c.accountId, d.accountId]);
    await later(app, a, 1);
    await later(app, a, 2);
    await setAges(ctx.client, c, { min: 18, max: 19 });

    expect((await later(app, a, 3)).later).toBe("listed");

    expect((await starsOf(ctx.client, a)).length).toBe(3);
  });

  test("Two devices at the cap: the second Later waits for the first, and says full", async () => {
    await withTwoConnections("kuutti-575-cap", async (pool, first, second) => {
      const who = await cast(pool, 3);
      const [a, b, c] = [person(who, 0), person(who, 1), person(who, 2)];
      await withMatchingConfig(pool, { stars_max: 1 });
      await queued(pool, a, [b.accountId, c.accountId]);
      const firstPid = await pidOf(first);
      const secondPid = await pidOf(second);
      await first.query("BEGIN");
      await second.query("BEGIN");
      const firstApp = await appOn(first);
      const secondApp = await appOn(second);
      await later(firstApp, a, 1);
      const racing = watched(Promise.resolve(decide(secondApp, a, TODAY, 2, "skip")));
      expect(await waitsFor(pool, secondPid, firstPid, racing.settled)).toBe(true);
      await first.query("COMMIT");
      const answer = await racing.outcome;
      await second.query("COMMIT");
      expect(answer).toBeInstanceOf(Response);
      expect((answer as Response).status).toBe(200);
      expect(QueueDecisionAnswer.parse(await (answer as Response).json()).later).toBe("full");
      expect(await starsOf(pool, a)).toEqual([b.accountId]);
    });
  });
});

describe("the queue and a star", () => {
  test("A starred person is not offered again as a card", async ({ ctx }) => {
    const { app, who } = await scene(ctx, 3);
    const [a, b, c] = [person(who, 0), person(who, 1), person(who, 2)];
    await starredYesterday(ctx.client, a, b);

    const read = await readToday(app, a);

    expect(cardsOf(read)).toEqual([c.accountId]);
    expect((await decide(app, a, TODAY, read.entries?.[0]?.position ?? 0, "pass")).status).toBe(
      200,
    );
    expect(cardsOf(await readToday(app, a))).toEqual([]);
    expect(await starsOf(ctx.client, a)).toEqual([b.accountId]);
    // Nor written into the day's log and hidden there: a page is not spent on them.
    const { rows } = await ctx.client.query<{ candidate_id: string }>(
      `SELECT e.candidate_id FROM queue_entry e JOIN queue_day r ON r.id = e.queue_day_id
        WHERE r.account_id = $1 AND r.day = $2`,
      [a.accountId, TODAY],
    );
    expect(rows.map((row) => row.candidate_id)).toEqual([c.accountId]);
  });

  test("Clearing a star puts them back in the queue", async ({ ctx }) => {
    const { app, who } = await scene(ctx, 2);
    const [a, b] = [person(who, 0), person(who, 1)];
    const id = await starredYesterday(ctx.client, a, b);

    expect((await clear(app, a, id)).status).toBe(204);

    const read = await readToday(app, a);
    expect(cardsOf(read)).toEqual([b.accountId]);
    expect(read.entries?.[0]?.reason).toBe("seen_before");
    expect(read.entries?.[0]?.star).toBeNull();
  });

  test("A star changes nothing for a like that waits", async ({ ctx }) => {
    const { app, who } = await scene(ctx, 2);
    const [a, b] = [person(who, 0), person(who, 1)];
    const id = await starredYesterday(ctx.client, a, b);
    await likedYesterday(ctx.client, b, a);

    const read = await readToday(app, a);

    expect(cardsOf(read)).toEqual([b.accountId]);
    expect(read.entries?.[0]?.reason).toBe("liked_you");
    expect(read.entries?.[0]?.star).toBe(id);
  });

  test("A read says the star on a card that holds one, and null on another", async ({ ctx }) => {
    const { app, who } = await scene(ctx, 3);
    const [a, b, c] = [person(who, 0), person(who, 1), person(who, 2)];
    const id = await starredYesterday(ctx.client, a, b);
    await likedYesterday(ctx.client, b, a);

    const read = await readToday(app, a);

    expect(cardsOf(read)).toEqual([b.accountId, c.accountId]);
    expect(read.entries?.map((entry) => entry.star)).toEqual([id, null]);
  });
});

describe("the list", () => {
  test("The list holds the people starred, the latest first, with their name, age and a photo shown", async ({
    ctx,
  }) => {
    const { app, who } = await scene(ctx, 3);
    const [a, b, c] = [person(who, 0), person(who, 1), person(who, 2)];
    await queued(ctx.client, a, [b.accountId, c.accountId]);
    const photoOfB = await cardShown(ctx.client, a.accountId, b.accountId, NOON);
    const photoOfC = await cardShown(ctx.client, a.accountId, c.accountId, NOON);
    await later(app, a, 1);
    await later(app, a, 2);
    const [starOnB, starOnC] = [await starOf(ctx.client, a, b), await starOf(ctx.client, a, c)];

    const list = await listOf(app, a);

    expect(list).toEqual([
      {
        id: starOnC,
        name: "Aino",
        age: 36,
        photo: { id: photoOfC, blurhash: expect.any(String) },
      },
      {
        id: starOnB,
        name: "Aino",
        age: 36,
        photo: { id: photoOfB, blurhash: expect.any(String) },
      },
    ]);
    // The star's id and nobody's account.
    expect(JSON.stringify(list)).not.toContain(b.accountId);
    expect(JSON.stringify(list)).not.toContain(c.accountId);
  });

  test("The list offers no photo the person was never shown", async ({ ctx }) => {
    const { app, who } = await scene(ctx, 2);
    const [a, b] = [person(who, 0), person(who, 1)];
    // The star's row with no shown record behind it, as after a new set of photos.
    const id = await starredYesterday(ctx.client, a, b);

    expect(await listOf(app, a)).toEqual([{ id, name: "Aino", age: 36, photo: null }]);
  });

  test("An empty list is a list, and it holds nobody else's stars", async ({ ctx }) => {
    const { app, who } = await scene(ctx, 3);
    const [a, b, c] = [person(who, 0), person(who, 1), person(who, 2)];
    await queued(ctx.client, a, [b.accountId]);
    await later(app, a, 1);

    expect(await listOf(app, c)).toEqual([]);
    expect(await listOf(app, b)).toEqual([]);
  });

  describe("The list leaves out whoever may not be shown, and takes them back", () => {
    const AGES = { min: 25, max: 40 };
    const NOT_THESE = { min: 18, max: 19 };
    type Change = (db: Queryable, a: Person, b: Person) => Promise<unknown>;
    const rows: { what: string; on: Change; off: Change }[] = [
      {
        what: "A narrowed their ages past B",
        on: (db, a) => setAges(db, a, NOT_THESE),
        off: (db, a) => setAges(db, a, AGES),
      },
      {
        what: "B narrowed their ages past A",
        on: (db, _a, b) => setAges(db, b, NOT_THESE),
        off: (db, _a, b) => setAges(db, b, AGES),
      },
      {
        what: "B stopped seeking A's gender",
        on: (db, _a, b) => setSeeks(db, b, ["woman"]),
        off: (db, _a, b) => setSeeks(db, b, ["non_binary"]),
      },
      {
        what: "A stopped seeking B's gender",
        on: (db, a) => setSeeks(db, a, ["woman"]),
        off: (db, a) => setSeeks(db, a, ["non_binary"]),
      },
      {
        what: "B paused",
        on: (db, _a, b) => setState(db, b, "paused"),
        off: (db, _a, b) => setState(db, b, "active"),
      },
      {
        what: "A paused",
        on: (db, a) => setState(db, a, "paused"),
        off: (db, a) => setState(db, a, "active"),
      },
      {
        what: "B was shadow-banned",
        on: (db, _a, b) => setState(db, b, "shadow_banned"),
        off: (db, _a, b) => setState(db, b, "active"),
      },
      {
        what: "B was suspended",
        on: (db, _a, b) => setState(db, b, "suspended"),
        off: (db, _a, b) => setState(db, b, "active"),
      },
      {
        what: "B took down the photos that completed them",
        on: (db, _a, b) => setPhotos(db, b, "rejected"),
        off: (db, _a, b) => setPhotos(db, b, "approved"),
      },
    ];
    test.for(rows)("$what", async ({ on, off }, { ctx }) => {
      const { app, who } = await scene(ctx, 2);
      const [a, b] = [person(who, 0), person(who, 1)];
      await queued(ctx.client, a, [b.accountId]);
      await later(app, a, 1);
      const id = await starOf(ctx.client, a, b);

      await on(ctx.client, a, b);

      expect(await listOf(app, a)).toEqual([]);
      const refused = await open(app, a, id);
      expect(refused.status).toBe(404);
      // The star stands meanwhile, with no clock on it.
      expect(await starsOf(ctx.client, a)).toEqual([b.accountId]);

      await off(ctx.client, a, b);

      expect((await listOf(app, a)).map((item) => item.id)).toEqual([id]);
      expect((await open(app, a, id)).status).toBe(200);
    });
  });

  test("Somebody who blocks stays out of the list for good, either way", async ({ ctx }) => {
    const { app, who } = await scene(ctx, 2);
    const [a, b] = [person(who, 0), person(who, 1)];
    const hers = await starredYesterday(ctx.client, a, b);
    const his = await starredYesterday(ctx.client, b, a);
    expect(await listOf(app, a)).toHaveLength(1);
    expect(await listOf(app, b)).toHaveLength(1);

    await block(ctx.client, a, b);

    expect(await listOf(app, a)).toEqual([]);
    expect(await listOf(app, b)).toEqual([]);
    expect((await open(app, a, hers)).status).toBe(404);
    expect((await open(app, b, his)).status).toBe(404);
  });

  test("Somebody past the inbox stop is left out, and back once below it", async ({ ctx }) => {
    const { app, who } = await scene(ctx, 3);
    const [a, b, liker] = [person(who, 0), person(who, 1), person(who, 2)];
    await withMatchingConfig(ctx.client, { inbox_stop: 1 });
    await likedYesterday(ctx.client, liker, b);
    const id = await starredYesterday(ctx.client, a, b);

    expect(await listOf(app, a)).toEqual([]);
    expect((await open(app, a, id)).status).toBe(404);

    // B goes through the like, and the pile falls below the stop.
    await shownAt(ctx.client, NOON, b.accountId, liker.accountId, "pass");

    expect((await listOf(app, a)).map((item) => item.id)).toEqual([id]);
    expect((await open(app, a, id)).status).toBe(200);
  });

  test("Somebody the person's own queue shows today stays on the list past the inbox stop", async ({
    ctx,
  }) => {
    const { app, who } = await scene(ctx, 3);
    const [a, b, liker] = [person(who, 0), person(who, 1), person(who, 2)];
    await queued(ctx.client, a, [b.accountId]);
    await later(app, a, 1);
    const id = await starOf(ctx.client, a, b);
    await withMatchingConfig(ctx.client, { inbox_stop: 1 });
    await likedYesterday(ctx.client, liker, b);

    expect((await listOf(app, a)).map((item) => item.id)).toEqual([id]);
    expect((await open(app, a, id)).status).toBe(200);
  });

  test("Somebody whose like waits on the person stays on the list past the inbox stop", async ({
    ctx,
  }) => {
    const { app, who } = await scene(ctx, 3);
    const [a, b, liker] = [person(who, 0), person(who, 1), person(who, 2)];
    await withMatchingConfig(ctx.client, { inbox_stop: 1 });
    await likedYesterday(ctx.client, liker, b);
    await likedYesterday(ctx.client, b, a);
    const id = await starredYesterday(ctx.client, a, b);

    expect((await listOf(app, a)).map((item) => item.id)).toEqual([id]);
    // The queue shows B all the same, so the list's silence would have told why.
    expect(cardsOf(await readToday(app, a))).toContain(b.accountId);
  });

  test("A read of the list asks the same of somebody at the inbox stop as of anybody", async ({
    ctx,
  }) => {
    const { app, who } = await scene(ctx, 3);
    const [a, b, liker] = [person(who, 0), person(who, 1), person(who, 2)];
    await withMatchingConfig(ctx.client, { inbox_stop: 1 });
    const id = await starredYesterday(ctx.client, a, b);
    const below = await statementsOfList(ctx.client, a);

    await likedYesterday(ctx.client, liker, b);

    expect(await listOf(app, a)).toEqual([]);
    expect(await statementsOfList(ctx.client, a)).toEqual(below);
    // Nor by the person's pool: the answer's time says nothing of anybody's pile (ADR-064 §6).
    expect(below.filter((statement) => /WHERE home_place IS NOT NULL/.test(statement))).toEqual([]);
    expect(id).toEqual(expect.any(String));
  });

  test("An inbox stop of zero is off, and leaves nobody out", async ({ ctx }) => {
    const { app, who } = await scene(ctx, 3);
    const [a, b, liker] = [person(who, 0), person(who, 1), person(who, 2)];
    await withMatchingConfig(ctx.client, { inbox_stop: 0 });
    await likedYesterday(ctx.client, liker, b);
    const id = await starredYesterday(ctx.client, a, b);

    expect((await listOf(app, a)).map((item) => item.id)).toEqual([id]);
  });

  test("The list of somebody with no open matching is empty", async ({ ctx }) => {
    const { app, who } = await scene(ctx, 2);
    const [a, b] = [person(who, 0), person(who, 1)];
    const id = await starredYesterday(ctx.client, a, b);
    const matching = (open: boolean) => withMatchingConfig(ctx.client, { matching_open: open });

    await matching(false);
    expect(await listOf(app, a)).toEqual([]);
    expect((await open(app, a, id)).status).toBe(404);
    expect(await starsOf(ctx.client, a)).toEqual([b.accountId]);

    await matching(true);
    expect((await listOf(app, a)).map((item) => item.id)).toEqual([id]);
  });
});

describe("a card opened from the list", () => {
  test("Opening a star writes the card into today's log, labelled seen before", async ({ ctx }) => {
    const { app, who } = await scene(ctx, 2);
    const [a, b] = [person(who, 0), person(who, 1)];
    const id = await starredYesterday(ctx.client, a, b);

    const answer = await opened(app, a, id);

    expect(answer.day).toBe(TODAY);
    const [entry] = answer.entries ?? [];
    expect(answer.entries).toHaveLength(1);
    expect(entry).toMatchObject({
      reason: "seen_before",
      decision: null,
      star: id,
      distance: "nearby",
    });
    expect(entry?.card.accountId).toBe(b.accountId);
    const { rows } = await ctx.client.query<{ candidate_id: string }>(
      `SELECT e.candidate_id FROM queue_day r JOIN queue_entry e ON e.queue_day_id = r.id
        WHERE r.account_id = $1 AND r.day = $2`,
      [a.accountId, TODAY],
    );
    expect(rows.map((row) => row.candidate_id)).toEqual([b.accountId]);
    // Served as a card is: the shown record, which a photo's URL stands on (ADR-008 §3).
    const shown = await ctx.client.query(
      `SELECT 1 FROM card_shown s JOIN photo p ON p.id = s.photo_id
        WHERE s.account_id = $1 AND p.account_id = $2`,
      [a.accountId, b.accountId],
    );
    expect(shown.rowCount).toBeGreaterThan(0);
    // Addressed as any card is.
    const seen = await app.request(`/queue/${TODAY}/entries/${entry?.position}/seen`, {
      method: "POST",
      headers: a.headers,
    });
    expect(seen.status).toBe(204);
  });

  test("Opening a star past the day's cards says their wait in Retry-After", async ({ ctx }) => {
    const { app, who } = await scene(ctx, 3);
    const [a, b, c] = [person(who, 0), person(who, 1), person(who, 2)];
    const id = await starredYesterday(ctx.client, a, b);
    await queued(ctx.client, a, [c.accountId]);
    await withMatchingConfig(ctx.client, { exposure_cards_per_day: 1 });
    await readToday(app, a);

    const answer = await open(app, a, id);

    expect(answer.status).toBe(429);
    expect(await errorCode(answer)).toBe("card_budget_exceeded");
    expect(Number(answer.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  test("Opening a star again the same day gives the same place", async ({ ctx }) => {
    const { app, who } = await scene(ctx, 2);
    const [a, b] = [person(who, 0), person(who, 1)];
    const id = await starredYesterday(ctx.client, a, b);

    const once = await opened(app, a, id);
    const twice = await opened(app, a, id);

    expect(twice.entries?.[0]?.position).toBe(once.entries?.[0]?.position);
    const { rows } = await ctx.client.query(
      `SELECT 1 FROM queue_day r JOIN queue_entry e ON e.queue_day_id = r.id
        WHERE r.account_id = $1 AND r.day = $2 AND e.candidate_id = $3`,
      [a.accountId, TODAY, b.accountId],
    );
    expect(rows).toHaveLength(1);
  });

  test("A card starred today opens at the place it has, as it stands", async ({ ctx }) => {
    const { app, who } = await scene(ctx, 2);
    const [a, b] = [person(who, 0), person(who, 1)];
    await queued(ctx.client, a, [b.accountId]);
    await later(app, a, 1);
    const id = await starOf(ctx.client, a, b);
    expect((await decide(app, a, TODAY, 1, "skip")).status).toBe(200);

    const answer = await opened(app, a, id);

    expect(answer.entries).toHaveLength(1);
    expect(answer.entries?.[0]).toMatchObject({
      position: 1,
      reason: "matches_filters",
      decision: "skip",
      star: id,
    });
  });

  test("A like from the list spends a like and takes the star off", async ({ ctx }) => {
    const { app, who } = await scene(ctx, 2);
    const [a, b] = [person(who, 0), person(who, 1)];
    const id = await starredYesterday(ctx.client, a, b);
    const { entries, likesLeft } = await opened(app, a, id);

    const answer = await decide(app, a, TODAY, entries?.[0]?.position ?? 0, "like");

    expect(answer.status).toBe(200);
    expect(QueueDecisionAnswer.parse(await answer.json()).likesLeft).toBe(likesLeft - 1);
    expect(await listOf(app, a)).toEqual([]);
    expect(await starsOf(ctx.client, a)).toEqual([]);
  });

  test("A like waiting makes a match from the list, as in the queue", async ({ ctx }) => {
    const { app, who } = await scene(ctx, 2);
    const [a, b] = [person(who, 0), person(who, 1)];
    const id = await starredYesterday(ctx.client, a, b);
    await likedYesterday(ctx.client, b, a);

    const { entries } = await opened(app, a, id);

    expect(entries?.[0]?.reason).toBe("liked_you");
    const answer = await decide(app, a, TODAY, entries?.[0]?.position ?? 0, "like");
    expect(answer.status).toBe(200);
    expect(QueueDecisionAnswer.parse(await answer.json()).match).not.toBeNull();
  });

  test("Later on a card opened from the list keeps its place on the list", async ({ ctx }) => {
    const { app, who } = await scene(ctx, 3);
    const [a, b, c] = [person(who, 0), person(who, 1), person(who, 2)];
    const id = await starredYesterday(ctx.client, a, b);
    await queued(ctx.client, a, [c.accountId]);
    expect((await later(app, a, 1)).later).toBe("listed");
    const { entries } = await opened(app, a, id);

    expect((await later(app, a, entries?.[0]?.position ?? 0)).later).toBe("listed");

    // The star that stood, not a new one: the list keeps the order it was put in.
    expect(await starOf(ctx.client, a, b)).toBe(id);
    expect((await listOf(app, a)).map((item) => item.id)).toEqual([
      await starOf(ctx.client, a, c),
      id,
    ]);
  });

  test("A fish waiting says so from the list too", async ({ ctx }) => {
    const { app, who } = await scene(ctx, 2);
    const [a, b] = [person(who, 0), person(who, 1)];
    const id = await starredYesterday(ctx.client, a, b);
    await likedYesterday(ctx.client, b, a, true);

    expect((await opened(app, a, id)).entries?.[0]?.reason).toBe("fish");
  });

  describe("A shadow-banned person's star on somebody whose like waits waits for the lift", () => {
    test.for([{ when: "yesterday" }, { when: "today, before the ban" }])(
      "starred $when",
      async ({ when }, { ctx }) => {
        const { app, who } = await scene(ctx, 2);
        const [a, b] = [person(who, 0), person(who, 1)];
        await likedYesterday(ctx.client, b, a);
        let id: string;
        if (when === "yesterday") {
          id = await starredYesterday(ctx.client, a, b);
        } else {
          await queued(ctx.client, a, [{ candidateId: b.accountId, reason: "liked_you" }]);
          await later(app, a, 1);
          id = await starOf(ctx.client, a, b);
        }
        await setState(ctx.client, a, "shadow_banned");

        expect(await listOf(app, a)).toEqual([]);
        expect((await open(app, a, id)).status).toBe(404);
        expect(await starsOf(ctx.client, a)).toEqual([b.accountId]);

        await setState(ctx.client, a, "active");

        expect((await listOf(app, a)).map((item) => item.id)).toEqual([id]);
        expect((await opened(app, a, id)).entries?.[0]?.reason).toBe("liked_you");
      },
    );
  });

  test("A shadow-banned person's list otherwise reads as anybody's", async ({ ctx }) => {
    const { app, who } = await scene(ctx, 2);
    const [a, b] = [person(who, 0), person(who, 1)];
    const id = await starredYesterday(ctx.client, a, b);
    await setState(ctx.client, a, "shadow_banned");

    expect((await listOf(app, a)).map((item) => item.id)).toEqual([id]);
    const { entries } = await opened(app, a, id);

    expect(entries?.[0]?.reason).toBe("seen_before");
  });

  test("A place for a shadow-banned person never says a like waits, should one come meanwhile", async ({
    ctx,
  }) => {
    const { who } = await scene(ctx, 2);
    const [a, b] = [person(who, 0), person(who, 1)];
    await likedYesterday(ctx.client, b, a);
    await setState(ctx.client, a, "shadow_banned");
    const { logger } = await captureLogger();

    const place = await starPlace(
      { db: ctx.client, logger, now: () => NOON },
      a.accountId,
      b.accountId,
    );

    expect(place?.reason).toBe("seen_before");
  });

  // The route asks the list first, which is empty while matching is closed; the place says so on its own too.
  test("There is no place while matching is closed", async ({ ctx }) => {
    const { who } = await scene(ctx, 2);
    const [a, b] = [person(who, 0), person(who, 1)];
    const { logger } = await captureLogger();
    const place = () =>
      starPlace({ db: ctx.client, logger, now: () => NOON }, a.accountId, b.accountId);

    expect((await place())?.reason).toBe("seen_before");
    await withMatchingConfig(ctx.client, { matching_open: false });
    expect(await place()).toBeNull();
  });

  test("A star opened through today's relaxation carries it, and its like arrives", async ({
    ctx,
  }) => {
    const { app, who } = await scene(ctx, 2);
    const [a, b] = [person(who, 0), person(who, 1)];
    const id = await starredYesterday(ctx.client, a, b);
    // A has a deal-breaker B does not pass, A's own answer standing so that it filters, relaxed for today.
    await ctx.client.query(
      `INSERT INTO preferences (account_id, field, value, mode, include_unknown)
       VALUES ($1, 'smoking', '["never"]'::jsonb, 'hard', false)`,
      [a.accountId],
    );
    await ctx.client.query(
      `UPDATE profile SET fields = fields || '{"smoking": "never"}'::jsonb WHERE account_id = $1`,
      [a.accountId],
    );
    expect(await listOf(app, a)).toEqual([]);
    const read = await logged(ctx.client, a.accountId, TODAY, []);
    await ctx.client.query(
      "INSERT INTO queue_relaxation (queue_day_id, field, kind) VALUES ($1, 'smoking', 'aside')",
      [read],
    );

    const { entries } = await opened(app, a, id);

    expect(entries?.[0]).toMatchObject({ reason: "relaxed", relaxedField: "smoking" });
    const liked = await decide(app, a, TODAY, entries?.[0]?.position ?? 0, "like");
    expect(liked.status).toBe(200);
    // The next day B's inbox shows it, A's deal-breaker waived for B by the like (ADR-042 §7).
    const tomorrow = await appOn(ctx.client, () => new Date(NOON.getTime() + DAY_MS));
    const round2 = await readToday(tomorrow, b);
    expect(cardsOf(round2)).toEqual([a.accountId]);
    expect(round2.entries?.[0]?.reason).toBe("liked_you");
  });

  test("A star stays while its card is opened and left, and the queue does not offer it", async ({
    ctx,
  }) => {
    const { app, who } = await scene(ctx, 2);
    const [a, b] = [person(who, 0), person(who, 1)];
    const id = await starredYesterday(ctx.client, a, b);
    await opened(app, a, id);

    expect(cardsOf(await readToday(app, a))).toEqual([]);
    expect((await listOf(app, a)).map((item) => item.id)).toEqual([id]);
  });

  test("Opening a star counts as a read of cards for the alarm", async ({ ctx }) => {
    const { app, who } = await scene(ctx, 2);
    const [a, b] = [person(who, 0), person(who, 1)];
    await withMatchingConfig(ctx.client, { auto_shadow_ban_cards_served: 1 });
    const id = await starredYesterday(ctx.client, a, b);

    await opened(app, a, id);

    const { rows } = await ctx.client.query<{ state: string }>(
      "SELECT state FROM account WHERE id = $1",
      [a.accountId],
    );
    expect(rows).toEqual([{ state: "shadow_banned" }]);
  });
});

describe("whose star", () => {
  test("Somebody else's star can be neither opened nor cleared", async ({ ctx }) => {
    const { app, who } = await scene(ctx, 3);
    const [a, b, c] = [person(who, 0), person(who, 1), person(who, 2)];
    const id = await starredYesterday(ctx.client, a, b);

    expect((await open(app, c, id)).status).toBe(404);
    expect((await clear(app, c, id)).status).toBe(404);

    expect(await starsOf(ctx.client, a)).toEqual([b.accountId]);
    const log = await ctx.client.query("SELECT 1 FROM queue_day WHERE account_id = $1", [
      c.accountId,
    ]);
    expect(log.rowCount).toBe(0);
  });

  test("A star cleared twice answers not_found the second time", async ({ ctx }) => {
    const { app, who } = await scene(ctx, 2);
    const [a, b] = [person(who, 0), person(who, 1)];
    const id = await starredYesterday(ctx.client, a, b);

    expect((await clear(app, a, id)).status).toBe(204);

    const again = await clear(app, a, id);
    expect(again.status).toBe(404);
    expect(await errorCode(again)).toBe("not_found");
  });

  test("A star's id that is no id is refused", async ({ ctx }) => {
    const { app, who } = await scene(ctx, 1);
    const a = person(who, 0);
    expect((await clear(app, a, "not-a-uuid")).status).toBe(400);
    expect((await open(app, a, "not-a-uuid")).status).toBe(400);
  });

  test("Every route of the stars asks for a session", async ({ ctx }) => {
    const app = await appOn(ctx.client);
    const id = "00000000-0000-4000-8000-000000000000";
    const answers = await Promise.all([
      app.request("/stars"),
      app.request(`/stars/${id}/open`, { method: "POST" }),
      app.request(`/stars/${id}`, { method: "DELETE" }),
    ]);
    for (const answer of answers) {
      expect(answer.status).toBe(401);
      expect(await errorCode(answer)).toBe("unauthenticated");
    }
  });
});

describe("erasure and the export", () => {
  describe("Erasure of either person takes the star", () => {
    test.for([{ erased: "A" }, { erased: "B" }])("$erased", async ({ erased }, { ctx }) => {
      const { who } = await scene(ctx, 2);
      const [a, b] = [person(who, 0), person(who, 1)];
      await starredYesterday(ctx.client, a, b);
      const { logger } = await captureLogger();

      const summary = await eraseAccount(
        { db: ctx.client, logger, now: () => NOON },
        erased === "A" ? a.accountId : b.accountId,
      );

      // How many the person put; how many were on them is in no count, a log line's included (§8).
      expect(summary.stars).toBe(erased === "A" ? 1 : 0);
      expect(await starsOf(ctx.client, a)).toEqual([]);
    });
  });

  test("The export says when, and never whom", async ({ ctx }) => {
    const { who } = await scene(ctx, 2);
    const [a, b] = [person(who, 0), person(who, 1)];
    await starredYesterday(ctx.client, a, b);
    const { logger } = await captureLogger();
    const deps = { db: ctx.client, logger, now: () => NOON, version: "test" };

    const { document } = await exportAccount(deps, a.accountId, englishT);
    const theirs = await exportAccount(deps, b.accountId, englishT);

    expect(document.stars.about).toMatch(/is not written here/);
    expect(document.stars.items).toEqual([{ at: YESTERDAY_NOON.toISOString() }]);
    expect(JSON.stringify(document.stars)).not.toContain(b.accountId);
    expect(theirs.document.stars.items).toEqual([]);
  });
});
