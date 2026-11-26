import type { Queryable } from "@kuutti/db";
import { type LikeAnchor, MessagePage, QueueDecisionAnswer } from "@kuutti/schema";
import type { App } from "../app.ts";
import { eraseAccount } from "../identity/index.ts";
import { addDays, finnishDay } from "../lib/finnish-day.ts";
import { anchorColumns } from "../matching/index.ts";
import { signInAs } from "../test/account.ts";
import { type ChatPerson, conversationBetween, detailOf, listOf } from "../test/chat.ts";
import { openExport } from "../test/export.ts";
import { STOPPED_CLOCK as T } from "../test/global-setup.ts";
import { captureLogger, describe, expect, test } from "../test/harness.ts";
import { appAt, logged, peopleWhoFit } from "../test/queue.ts";
import { firstMessageCounts } from "./first-messages.ts";

// What a match keeps of its likes (#463, ADR-077, features/chat/anchors.feature):
// both parts on the conversation's participant rows, drawn from the profiles as
// they stand, left out once gone or once the conversation has ended, no message,
// cleared by an erasure and carried in words by the person's own export. The
// like's part itself is matching/anchored-likes.test.ts.

const TODAY = finnishDay(T);
const DAY_MS = 24 * 60 * 60 * 1000;

/** Two people who fit each other, A named Aino and B Bertta, B with an answered prompt; signed in. */
async function aAndB(db: Queryable): Promise<[ChatPerson, ChatPerson]> {
  const ids = await peopleWhoFit(db, 2);
  const [a, b] = await Promise.all(ids.map((id) => signInAs(db, id)));
  if (!a || !b) throw new Error("cast not written");
  await db.query(
    "UPDATE profile SET display_name = 'Bertta', prompts = $2::jsonb WHERE account_id = $1",
    [b.accountId, JSON.stringify([{ key: "sunday", answer: "Long walks by the sea." }])],
  );
  return [a, b];
}

async function photosOf(db: Queryable, who: ChatPerson): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    "SELECT id FROM photo WHERE account_id = $1 ORDER BY position",
    [who.accountId],
  );
  return rows.map((row) => row.id);
}

/**
 * B liked A yesterday naming `ofA`, a part of A's card, and A likes B today
 * naming `ofB`, a part of B's, through the route: the match. Its conversation.
 */
async function matched(
  db: Queryable,
  app: App,
  [a, b]: [ChatPerson, ChatPerson],
  ofA: LikeAnchor | null,
  ofB: LikeAnchor | null,
): Promise<string> {
  const yesterday = await logged(db, b.accountId, addDays(TODAY, -1), [a.accountId]);
  await db.query(
    `UPDATE queue_entry SET decision = 'like', decided_at = $2,
            anchor_kind = $3, anchor_ref = $4, anchor_field = $5
      WHERE queue_day_id = $1`,
    [yesterday, new Date(T.getTime() - DAY_MS), ...anchorColumns(ofA)],
  );
  await logged(db, a.accountId, TODAY, [{ candidateId: b.accountId, reason: "liked_you" }]);
  const answer = await app.request(`/queue/${TODAY}/entries/1/decision`, {
    method: "PUT",
    headers: { ...a.headers, "content-type": "application/json" },
    body: JSON.stringify(ofB ? { decision: "like", anchor: ofB } : { decision: "like" }),
  });
  expect(answer.status).toBe(200);
  const id = QueueDecisionAnswer.parse(await answer.json()).match?.conversationId;
  if (!id) throw new Error("no match");
  return id;
}

/** The parts as the two participant rows keep them, side a first. */
async function keptOn(db: Queryable, conversationId: string) {
  const { rows } = await db.query<{ account_id: string; anchor: (string | null)[] }>(
    `SELECT account_id, ARRAY[anchor_kind::text, anchor_ref, anchor_field] AS anchor
       FROM conversation_participant WHERE conversation_id = $1 ORDER BY side`,
    [conversationId],
  );
  return rows;
}

describe("a match's parts", () => {
  test("A match carries both likes' parts into the conversation", async ({ ctx }) => {
    const cast = await aAndB(ctx.client);
    const [a, b] = cast;
    const app = await appAt(ctx.client);
    const [first] = await photosOf(ctx.client, b);

    const id = await matched(
      ctx.client,
      app,
      cast,
      { kind: "bio" },
      {
        kind: "photo",
        photoId: first as never,
      },
    );

    const ofA = (await detailOf(app, a, id)).anchors;
    expect(ofA?.mine).toMatchObject({ kind: "photo", photo: { id: first } });
    expect(ofA?.theirs).toEqual({ kind: "bio" });
    const ofB = (await detailOf(app, b, id)).anchors;
    expect(ofB?.mine).toEqual({ kind: "bio" });
    expect(ofB?.theirs).toMatchObject({ kind: "photo", photo: { id: first } });
    // The earlier liker on side a, each like's part on its own row.
    expect(await keptOn(ctx.client, id)).toEqual([
      { account_id: b.accountId, anchor: ["bio", null, null] },
      { account_id: a.accountId, anchor: ["photo", first, null] },
    ]);
  });

  test("A like that named nothing brings nothing into the conversation", async ({ ctx }) => {
    const cast = await aAndB(ctx.client);
    const [a, b] = cast;
    const app = await appAt(ctx.client);

    const id = await matched(ctx.client, app, cast, null, { kind: "bio" });

    expect((await detailOf(app, a, id)).anchors).toEqual({ mine: { kind: "bio" }, theirs: null });
    expect((await detailOf(app, b, id)).anchors).toEqual({ mine: null, theirs: { kind: "bio" } });
  });

  test("A part that has gone since is left out of the conversation", async ({ ctx }) => {
    const cast = await aAndB(ctx.client);
    const [a, b] = cast;
    const app = await appAt(ctx.client);
    const second = (await photosOf(ctx.client, a))[1];
    const id = await matched(
      ctx.client,
      app,
      cast,
      { kind: "photo", photoId: second as never },
      {
        kind: "prompt",
        prompt: "sunday",
      },
    );

    await ctx.client.query("DELETE FROM photo WHERE id = $1 AND account_id = $2", [
      second,
      a.accountId,
    ]);

    expect((await detailOf(app, b, id)).anchors).toEqual({
      mine: null,
      theirs: { kind: "prompt", prompt: "sunday" },
    });
    // Kept as it was named: a photo put back would read again.
    expect((await keptOn(ctx.client, id))[0]?.anchor).toEqual(["photo", second, null]);
  });

  test("The parts are no message", async ({ ctx }) => {
    const cast = await aAndB(ctx.client);
    const [a, b] = cast;
    const app = await appAt(ctx.client);
    const id = await matched(ctx.client, app, cast, { kind: "bio" }, { kind: "bio" });

    const row = (await listOf(app, a, "?thumbs=false")).open.find((c) => c.id === id);
    const detail = await detailOf(app, a, id);
    const page = await app.request(`/conversations/${id}/messages`, { headers: a.headers });

    expect(row?.lastMessage).toBeNull();
    expect(detail.anchors).toEqual({ mine: { kind: "bio" }, theirs: { kind: "bio" } });
    expect(page.status).toBe(200);
    expect(MessagePage.parse(await page.json()).messages).toEqual([]);
    for (const who of [a, b]) {
      const counted = await firstMessageCounts(ctx.client, {
        accountId: who.accountId,
        conversationId: id,
        firstSince: new Date(0),
        sameSince: new Date(0),
      });
      expect(counted.first.count).toBe(0);
    }
  });

  test("a conversation opened with no like's parts says none", async ({ ctx }) => {
    const [a, b] = await aAndB(ctx.client);
    const id = await conversationBetween(ctx.client, a.accountId, b.accountId);

    expect((await detailOf(await appAt(ctx.client), a, id)).anchors).toEqual({
      mine: null,
      theirs: null,
    });
  });

  test("an ended conversation names no part, though the rows keep them", async ({ ctx }) => {
    // An ended conversation names nobody (ADR-031 §5): the parts with it.
    const cast = await aAndB(ctx.client);
    const [a] = cast;
    const app = await appAt(ctx.client);
    const id = await matched(ctx.client, app, cast, { kind: "bio" }, { kind: "bio" });
    await ctx.client.query(
      "UPDATE conversation SET closed_at = $2, closed_how = 'unmatch', closed_by = 'b' WHERE id = $1",
      [id, T],
    );

    expect((await detailOf(app, a, id)).anchors).toEqual({ mine: null, theirs: null });
  });

  test("an erasure takes both likes' parts off the conversation", async ({ ctx }) => {
    const cast = await aAndB(ctx.client);
    const [a, b] = cast;
    const app = await appAt(ctx.client);
    const id = await matched(
      ctx.client,
      app,
      cast,
      { kind: "bio" },
      { kind: "prompt", prompt: "sunday" },
    );
    const { logger } = await captureLogger();

    await eraseAccount({ db: ctx.client, logger, now: () => T }, a.accountId);

    expect((await keptOn(ctx.client, id)).map((row) => row.anchor)).toEqual([
      [null, null, null],
      [null, null, null],
    ]);
    expect((await detailOf(app, b, id)).anchors).toEqual({ mine: null, theirs: null });
  });

  test("an erasure leaves other people's conversations' parts alone", async ({ ctx }) => {
    const cast = await aAndB(ctx.client);
    const app = await appAt(ctx.client);
    const id = await matched(ctx.client, app, cast, { kind: "bio" }, { kind: "bio" });
    const [someoneElse] = await peopleWhoFit(ctx.client, 1);
    if (!someoneElse) throw new Error("nobody else");
    const { logger } = await captureLogger();

    await eraseAccount({ db: ctx.client, logger, now: () => T }, someoneElse);

    expect((await keptOn(ctx.client, id)).map((row) => row.anchor)).toEqual([
      ["bio", null, null],
      ["bio", null, null],
    ]);
  });

  test("each person's export says their own like's part in words, never the other's photo", async ({
    ctx,
  }) => {
    const cast = await aAndB(ctx.client);
    const [a, b] = cast;
    const app = await appAt(ctx.client);
    const [first] = await photosOf(ctx.client, b);
    await matched(
      ctx.client,
      app,
      cast,
      { kind: "bio" },
      { kind: "photo", photoId: first as never },
    );

    const mine = await openExport(
      await app.request("/account/export", { headers: { ...a.headers, "accept-language": "en" } }),
    );
    const theirs = await openExport(
      await app.request("/account/export", { headers: { ...b.headers, "accept-language": "en" } }),
    );

    expect(mine.document.conversations[0]?.liked).toEqual({
      kind: "photo",
      prompt: null,
      shared: null,
      inWords: "Liked their photo",
    });
    expect(theirs.document.conversations[0]?.liked).toEqual({
      kind: "bio",
      prompt: null,
      shared: null,
      inWords: "Liked their bio",
    });
    expect(mine.raw).not.toContain(String(first));
    expect(mine.raw).not.toContain("Bertta");
  });
});
