import type { Queryable } from "@kuutti/db";
import { type LikeAnchor, type QueueEntry, type QueueReason, QueueResponse } from "@kuutti/schema";
import type { App } from "../app.ts";
import { exportAccount } from "../identity/index.ts";
import { addDays, finnishDay } from "../lib/finnish-day.ts";
import { signInAs } from "../test/account.ts";
import { errorCode } from "../test/answers.ts";
import { STOPPED_CLOCK as T } from "../test/global-setup.ts";
import { captureLogger, describe, englishT, expect, test } from "../test/harness.ts";
import { appAt, logged, peopleWhoFit } from "../test/queue.ts";
import { anchorColumns } from "./anchor.ts";

// The anchored like (#463, ADR-077, features/matching/anchored-likes.feature):
// a like or a fish naming one part of the card, checked against the card for
// that place, the same part again and another, a matched like, what the person
// liked reads on the liker's card, a part gone since, and the export. What the
// conversation keeps of it is chat/anchors.test.ts; the three columns and the
// words are anchor.test.ts.

const TODAY = finnishDay(T);
const YESTERDAY = addDays(TODAY, -1);
const MINUTE = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE;

type Person = { accountId: string; headers: { authorization: string } };

/** What B's answered prompt says: never in anybody else's export. */
const B_ANSWER = "Long walks by the sea, then a sauna.";

/**
 * A and B, who fit each other, both with yoga among their hobbies and each with
 * an answered prompt, B named Bertta; signed in. Three approved photos and a
 * written bio each, as `people` makes a complete profile.
 */
async function aAndB(db: Queryable): Promise<[Person, Person]> {
  const ids = await peopleWhoFit(db, 2, { fields: { hobbies: ["yoga"] } });
  const [a, b] = await Promise.all(ids.map((id) => signInAs(db, id)));
  if (!a || !b) throw new Error("cast not written");
  await answers(db, a, [{ key: "proud_of", answer: "Finishing a marathon." }]);
  await answers(db, b, [{ key: "sunday", answer: B_ANSWER }]);
  await db.query("UPDATE profile SET display_name = 'Bertta' WHERE account_id = $1", [b.accountId]);
  return [a, b];
}

const answers = (db: Queryable, who: Person, prompts: { key: string; answer: string }[]) =>
  db.query("UPDATE profile SET prompts = $2::jsonb WHERE account_id = $1", [
    who.accountId,
    JSON.stringify(prompts),
  ]);

/** The person's approved photos' ids, in the order of their card. */
async function photosOf(db: Queryable, who: Person): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    "SELECT id FROM photo WHERE account_id = $1 ORDER BY position",
    [who.accountId],
  );
  return rows.map((row) => row.id);
}

/** `owner`'s queue today, `card` its one card; its id. */
const todayHolds = (db: Queryable, owner: Person, card: Person, reason?: QueueReason) =>
  logged(db, owner.accountId, TODAY, [
    reason ? { candidateId: card.accountId, reason } : card.accountId,
  ]);

/** `liker` liked `liked` on yesterday's queue, naming `anchor`, as a like through the route writes it. */
async function likedYesterday(
  db: Queryable,
  liker: Person,
  liked: Person,
  anchor: LikeAnchor | null,
) {
  const queueDayId = await logged(db, liker.accountId, YESTERDAY, [liked.accountId]);
  await db.query(
    `UPDATE queue_entry SET decision = 'like', decided_at = $2,
            anchor_kind = $3, anchor_ref = $4, anchor_field = $5
      WHERE queue_day_id = $1`,
    [queueDayId, new Date(T.getTime() - DAY_MS), ...anchorColumns(anchor)],
  );
}

/** The decision on the first card of today's queue, naming `anchor` when one is given. */
const decideBy = (app: App, who: Person, decision: string, anchor?: unknown) =>
  app.request(`/queue/${TODAY}/entries/1/decision`, {
    method: "PUT",
    headers: { ...who.headers, "content-type": "application/json" },
    body: JSON.stringify(anchor === undefined ? { decision } : { decision, anchor }),
  });

/** The first card of a queue as it is kept. */
async function entryOf(db: Queryable, queueDayId: string) {
  const { rows } = await db.query<{
    decision: string | null;
    fish: boolean;
    decided_at: Date | null;
    anchor: [string | null, string | null, string | null];
  }>(
    `SELECT decision, fish, decided_at, ARRAY[anchor_kind::text, anchor_ref, anchor_field] AS anchor
       FROM queue_entry WHERE queue_day_id = $1 AND position = 1`,
    [queueDayId],
  );
  const entry = rows[0];
  if (!entry) throw new Error("no card");
  return entry;
}

/** The first card of the person's queue as a read of today serves it. */
async function firstCardOf(app: App, who: Person): Promise<QueueEntry> {
  const read = await app.request("/queue/today", { headers: who.headers });
  expect(read.status).toBe(200);
  const entry = QueueResponse.parse(await read.json()).entries?.[0];
  if (!entry) throw new Error("no card served");
  return entry;
}

describe("the like names a part", () => {
  describe("A like may name one part of the card", () => {
    test.for([
      { part: '"B"\'s second photo' },
      { part: '"B"\'s answered prompt' },
      { part: '"B"\'s bio' },
      { part: "the shared hobby" },
    ])("$part", async ({ part }, { ctx }) => {
      const [a, b] = await aAndB(ctx.client);
      const queueDayId = await todayHolds(ctx.client, a, b);
      const second = (await photosOf(ctx.client, b))[1];
      const named = {
        '"B"\'s second photo': [{ kind: "photo", photoId: second }, ["photo", second, null]],
        '"B"\'s answered prompt': [
          { kind: "prompt", prompt: "sunday" },
          ["prompt", "sunday", null],
        ],
        '"B"\'s bio': [{ kind: "bio" }, ["bio", null, null]],
        "the shared hobby": [
          { kind: "shared", field: "hobbies", option: "yoga" },
          ["shared", "yoga", "hobbies"],
        ],
      }[part];
      if (!named) throw new Error(`no such part: ${part}`);

      const answer = await decideBy(await appAt(ctx.client), a, "like", named[0]);

      expect(answer.status).toBe(200);
      const entry = await entryOf(ctx.client, queueDayId);
      expect(entry.decision).toBe("like");
      expect(entry.anchor).toEqual(named[1]);
    });
  });

  describe("A part that is not on the card at that place is refused, and nothing is written", () => {
    test.for([
      { part: "a photo of somebody else's" },
      { part: 'a prompt "B" has not answered' },
      { part: "the bio of a card without one" },
      { part: 'a hobby "B" has and "A" has not' },
    ])("$part", async ({ part }, { ctx }) => {
      const [a, b] = await aAndB(ctx.client);
      const [someoneElse] = await peopleWhoFit(ctx.client, 1);
      if (!someoneElse) throw new Error("nobody else");
      const queueDayId = await todayHolds(ctx.client, a, b);
      let anchor: LikeAnchor;
      if (part === "a photo of somebody else's") {
        const [theirs] = await photosOf(ctx.client, { accountId: someoneElse, headers: a.headers });
        anchor = { kind: "photo", photoId: theirs as never };
      } else if (part === 'a prompt "B" has not answered') {
        anchor = { kind: "prompt", prompt: "proud_of" };
      } else if (part === "the bio of a card without one") {
        await ctx.client.query(
          "UPDATE profile SET bio = NULL, bio_preset = NULL WHERE account_id = $1",
          [b.accountId],
        );
        anchor = { kind: "bio" };
      } else {
        await ctx.client.query(
          `UPDATE profile SET fields = jsonb_set(fields, '{hobbies}', '["yoga", "chess"]')
            WHERE account_id = $1`,
          [b.accountId],
        );
        anchor = { kind: "shared", field: "hobbies", option: "chess" };
      }

      const answer = await decideBy(await appAt(ctx.client), a, "like", anchor);

      expect(answer.status).toBe(400);
      expect(await errorCode(answer)).toBe("anchor_not_on_card");
      const entry = await entryOf(ctx.client, queueDayId);
      expect(entry.decision).toBeNull();
      expect(entry.anchor).toEqual([null, null, null]);
    });
  });

  test("A pass or a skip names no part", async ({ ctx }) => {
    const [a, b] = await aAndB(ctx.client);
    const queueDayId = await todayHolds(ctx.client, a, b);
    const app = await appAt(ctx.client);

    for (const decision of ["pass", "skip"]) {
      const answer = await decideBy(app, a, decision, { kind: "bio" });
      expect(answer.status).toBe(400);
      expect(await errorCode(answer)).toBe("validation_failed");
    }

    const entry = await entryOf(ctx.client, queueDayId);
    expect(entry.decision).toBeNull();
    expect(entry.anchor).toEqual([null, null, null]);
  });

  test("The same like with the same part writes nothing, and another part is a revision", async ({
    ctx,
  }) => {
    const [a, b] = await aAndB(ctx.client);
    const queueDayId = await todayHolds(ctx.client, a, b);
    const [first] = await photosOf(ctx.client, b);
    const at = (minutes: number) => appAt(ctx.client, new Date(T.getTime() + minutes * MINUTE));
    expect((await decideBy(await at(0), a, "like", { kind: "photo", photoId: first })).status).toBe(
      200,
    );

    expect((await decideBy(await at(1), a, "like", { kind: "photo", photoId: first })).status).toBe(
      200,
    );
    const again = await entryOf(ctx.client, queueDayId);
    expect(again.anchor).toEqual(["photo", first, null]);
    expect(again.decided_at).toEqual(T);

    expect((await decideBy(await at(2), a, "like", { kind: "bio" })).status).toBe(200);
    const revised = await entryOf(ctx.client, queueDayId);
    expect(revised.anchor).toEqual(["bio", null, null]);
    expect(revised.decided_at).toEqual(new Date(T.getTime() + 2 * MINUTE));

    expect((await decideBy(await at(3), a, "like")).status).toBe(200);
    const plain = await entryOf(ctx.client, queueDayId);
    expect(plain.decision).toBe("like");
    expect(plain.anchor).toEqual([null, null, null]);
    expect(plain.decided_at).toEqual(new Date(T.getTime() + 3 * MINUTE));
  });

  test("A like that made a match keeps its part", async ({ ctx }) => {
    const [a, b] = await aAndB(ctx.client);
    await likedYesterday(ctx.client, b, a, null);
    const queueDayId = await todayHolds(ctx.client, a, b, "liked_you");
    const app = await appAt(ctx.client);
    expect((await decideBy(app, a, "like", { kind: "bio" })).status).toBe(200);
    const [first] = await photosOf(ctx.client, b);

    const answer = await decideBy(app, a, "like", { kind: "photo", photoId: first });

    expect(answer.status).toBe(409);
    expect(await errorCode(answer)).toBe("match_made");
    expect((await entryOf(ctx.client, queueDayId)).anchor).toEqual(["bio", null, null]);
  });

  test("A fish may name a part as a like does", async ({ ctx }) => {
    const [a, b] = await aAndB(ctx.client);
    const queueDayId = await todayHolds(ctx.client, a, b);

    const answer = await decideBy(await appAt(ctx.client), a, "fish", {
      kind: "prompt",
      prompt: "sunday",
    });

    expect(answer.status).toBe(200);
    const entry = await entryOf(ctx.client, queueDayId);
    expect(entry).toMatchObject({ decision: "like", fish: true });
    expect(entry.anchor).toEqual(["prompt", "sunday", null]);
  });

  test("the contract refuses what is no part at all, and a caller with no session", async ({
    ctx,
  }) => {
    const [a, b] = await aAndB(ctx.client);
    const queueDayId = await todayHolds(ctx.client, a, b);
    const app = await appAt(ctx.client);

    for (const anchor of [
      { kind: "photo" },
      { kind: "photo", photoId: "not-a-photo" },
      { kind: "prompt", prompt: "favourite_colour" },
      { kind: "shared", field: "hobbies", option: "x".repeat(81) },
      { kind: "shared", field: "height", option: "180" },
      { kind: "smile" },
      { kind: "bio", text: "my own words" },
    ]) {
      const answer = await decideBy(app, a, "like", anchor);
      expect(answer.status, JSON.stringify(anchor)).toBe(400);
      expect(await errorCode(answer)).toBe("validation_failed");
    }
    const unsigned = await app.request(`/queue/${TODAY}/entries/1/decision`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "like", anchor: { kind: "bio" } }),
    });
    expect(unsigned.status).toBe(401);

    const entry = await entryOf(ctx.client, queueDayId);
    expect(entry.decision).toBeNull();
    expect(entry.anchor).toEqual([null, null, null]);
  });
});

describe("what the person liked reads", () => {
  describe("The person liked reads the part on the liker's card, from their own profile as it stands", () => {
    test.for([
      { part: "the second photo", says: '"liked your photo", with that photo' },
      { part: "the first prompt", says: '"liked your answer to" the prompt' },
      { part: "the bio", says: '"liked your bio"' },
      { part: "the ready line", says: '"liked your bio"' },
      { part: "the shared hobby", says: '"liked that you both" have the hobby' },
    ])("$part: $says", async ({ part }, { ctx }) => {
      const [a, b] = await aAndB(ctx.client);
      const photos = await photosOf(ctx.client, a);
      const second = photos[1];
      if (part === "the ready line") {
        await ctx.client.query(
          "UPDATE profile SET bio = NULL, bio_preset = 'photos_speak' WHERE account_id = $1",
          [a.accountId],
        );
      }
      const anchor: LikeAnchor = {
        "the second photo": { kind: "photo", photoId: second as never },
        "the first prompt": { kind: "prompt", prompt: "proud_of" },
        "the bio": { kind: "bio" },
        "the ready line": { kind: "bio" },
        "the shared hobby": { kind: "shared", field: "hobbies", option: "yoga" },
      }[part] as LikeAnchor;
      await likedYesterday(ctx.client, b, a, anchor);
      await todayHolds(ctx.client, a, b, "liked_you");

      const card = await firstCardOf(await appAt(ctx.client), a);

      expect(card.reason).toBe("liked_you");
      expect(card.card.accountId).toBe(b.accountId);
      if (part === "the second photo") {
        expect(card.likedYour).toMatchObject({ kind: "photo", photo: { id: second } });
      } else {
        expect(card.likedYour).toEqual(
          {
            "the first prompt": { kind: "prompt", prompt: "proud_of" },
            "the bio": { kind: "bio" },
            "the ready line": { kind: "bio" },
            "the shared hobby": { kind: "shared", field: "hobbies", option: "yoga" },
          }[part],
        );
      }
    });
  });

  describe("A part that has gone since reads as a plain liked you", () => {
    test.for([
      { part: "the second photo", change: '"A" removed that photo' },
      { part: "the first prompt", change: '"A" cleared that prompt\'s answer' },
      { part: "the bio", change: '"A" removed the bio' },
      { part: "the shared hobby", change: '"B" no longer has the hobby' },
    ])("$part, then $change", async ({ part }, { ctx }) => {
      const [a, b] = await aAndB(ctx.client);
      const second = (await photosOf(ctx.client, a))[1];
      const gone: Record<string, [LikeAnchor, string, string]> = {
        "the second photo": [
          { kind: "photo", photoId: second as never },
          "DELETE FROM photo WHERE id = $2 AND account_id = $1",
          a.accountId,
        ],
        "the first prompt": [
          { kind: "prompt", prompt: "proud_of" },
          "UPDATE profile SET prompts = '[]'::jsonb WHERE account_id = $1",
          a.accountId,
        ],
        "the bio": [
          { kind: "bio" },
          "UPDATE profile SET bio = NULL, bio_preset = NULL WHERE account_id = $1",
          a.accountId,
        ],
        "the shared hobby": [
          { kind: "shared", field: "hobbies", option: "yoga" },
          "UPDATE profile SET fields = fields - 'hobbies' WHERE account_id = $1",
          b.accountId,
        ],
      };
      const [anchor, change, whose] = gone[part] ?? [];
      if (!anchor || !change || !whose) throw new Error(`no such part: ${part}`);
      await likedYesterday(ctx.client, b, a, anchor);
      await ctx.client.query(change, change.includes("$2") ? [whose, second] : [whose]);
      await todayHolds(ctx.client, a, b, "liked_you");

      const card = await firstCardOf(await appAt(ctx.client), a);

      expect(card.reason).toBe("liked_you");
      expect(card.card.accountId).toBe(b.accountId);
      expect(card.likedYour).toBeUndefined();
    });
  });

  test("a fish card says the part as a liked-you card does", async ({ ctx }) => {
    const [a, b] = await aAndB(ctx.client);
    await likedYesterday(ctx.client, b, a, { kind: "bio" });
    await ctx.client.query(
      `UPDATE queue_entry e SET fish = true FROM queue_day r
        WHERE r.id = e.queue_day_id AND r.account_id = $1`,
      [b.accountId],
    );
    await todayHolds(ctx.client, a, b, "fish");

    const card = await firstCardOf(await appAt(ctx.client), a);

    expect(card.reason).toBe("fish");
    expect(card.likedYour).toEqual({ kind: "bio" });
  });

  test("an ordinary card names no part, whatever its person's like named", async ({ ctx }) => {
    // A card that does not say it answers a like says nothing of one (ADR-037 §2).
    const [a, b] = await aAndB(ctx.client);
    await likedYesterday(ctx.client, b, a, { kind: "bio" });
    await todayHolds(ctx.client, a, b);

    const card = await firstCardOf(await appAt(ctx.client), a);

    expect(card.reason).toBe("matches_filters");
    expect(card.likedYour).toBeUndefined();
  });

  test("a like of today names nothing on a card of today", async ({ ctx }) => {
    // The like that waits is of an ended day (ADR-037 §2): one made today is not
    // what a liked-you card answers.
    const [a, b] = await aAndB(ctx.client);
    const bToday = await todayHolds(ctx.client, b, a);
    await ctx.client.query(
      `UPDATE queue_entry SET decision = 'like', decided_at = $2, anchor_kind = 'bio'
        WHERE queue_day_id = $1`,
      [bToday, T],
    );
    await todayHolds(ctx.client, a, b, "liked_you");

    const card = await firstCardOf(await appAt(ctx.client), a);

    expect(card.likedYour).toBeUndefined();
  });

  test("the newest of the liker's likes is the one read", async ({ ctx }) => {
    const [a, b] = await aAndB(ctx.client);
    const older = await logged(ctx.client, b.accountId, addDays(TODAY, -3), [a.accountId]);
    await ctx.client.query(
      `UPDATE queue_entry SET decision = 'like', decided_at = $2, anchor_kind = 'prompt', anchor_ref = 'proud_of'
        WHERE queue_day_id = $1`,
      [older, new Date(T.getTime() - 3 * DAY_MS)],
    );
    await likedYesterday(ctx.client, b, a, { kind: "bio" });
    await todayHolds(ctx.client, a, b, "liked_you");

    const card = await firstCardOf(await appAt(ctx.client), a);

    expect(card.likedYour).toEqual({ kind: "bio" });
  });
});

describe("the export", () => {
  test("The sender's export names the part, never the other person's words", async ({ ctx }) => {
    const [a, b] = await aAndB(ctx.client);
    await todayHolds(ctx.client, a, b);
    expect(
      (
        await decideBy(await appAt(ctx.client), a, "like", {
          kind: "prompt",
          prompt: "sunday",
        })
      ).status,
    ).toBe(200);

    const { logger } = await captureLogger();
    const { document } = await exportAccount(
      { db: ctx.client, logger, now: () => T, version: "test" },
      a.accountId,
      englishT,
    );

    expect(document.queue.items[0]?.entries[0]?.anchor).toEqual({
      kind: "prompt",
      prompt: "sunday",
      shared: null,
      inWords: "Liked their answer to: My ideal Sunday",
    });
    const written = JSON.stringify(document);
    expect(written).not.toContain(B_ANSWER);
    expect(written).not.toContain("Bertta");
    expect(written).not.toContain(b.accountId);
  });

  test("the export says each kind of part in words, and nothing for a like that named none", async ({
    ctx,
  }) => {
    const [a, b] = await aAndB(ctx.client);
    const queueDayId = await todayHolds(ctx.client, a, b);
    const [first] = await photosOf(ctx.client, b);
    const exported = async () => {
      const { logger } = await captureLogger();
      const { document } = await exportAccount(
        { db: ctx.client, logger, now: () => T, version: "test" },
        a.accountId,
        englishT,
      );
      return document.queue.items[0]?.entries[0]?.anchor;
    };
    const name = (anchor: LikeAnchor | null) =>
      ctx.client.query(
        `UPDATE queue_entry SET decision = 'like', decided_at = $2,
                anchor_kind = $3, anchor_ref = $4, anchor_field = $5
          WHERE queue_day_id = $1`,
        [queueDayId, T, ...anchorColumns(anchor)],
      );

    await name({ kind: "photo", photoId: first as never });
    expect(await exported()).toEqual({
      kind: "photo",
      prompt: null,
      shared: null,
      inWords: "Liked their photo",
    });
    expect(JSON.stringify(await exported())).not.toContain(String(first));
    await name({ kind: "bio" });
    expect(await exported()).toEqual({
      kind: "bio",
      prompt: null,
      shared: null,
      inWords: "Liked their bio",
    });
    await name({ kind: "shared", field: "hobbies", option: "yoga" });
    expect(await exported()).toEqual({
      kind: "shared",
      prompt: null,
      shared: { field: "hobbies", option: "yoga" },
      inWords: "Liked what you share: Yoga",
    });
    await name(null);
    expect(await exported()).toBeNull();
  });
});
