import { NotificationChoices } from "@kuutti/schema";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type App, createApp } from "../app.ts";
import { eraseAccount } from "../identity/index.ts";
import { type SignedIn, signedInAccount } from "../test/account.ts";
import { withErasureRace } from "../test/erasure-race.ts";
import { exportOf } from "../test/export.ts";
import {
  captureLogger,
  count,
  jsonHeaders as json,
  type TestContext,
  test,
  testConfig,
} from "../test/harness.ts";
import * as repo from "./repo.ts";
import { unsubscribeBase, unsubscribeLinkOf } from "./unsubscribe.ts";

// The one-click unsubscribe of the announcement email (#196, RFC 8058, ADR-068
// §5): the route a mail app posts to, the secret behind it, and where its link
// points. The scenarios of features/notifications/announcements.feature walk
// it from an email; these hold each rule of the route and the secret alone.

const BASE = "https://api.example.test/mail/unsubscribe/";
const AT = new Date("2026-11-18T10:00:00.000Z");
/** A secret of the generator's shape: 43 characters of base64url. */
const FRESH = "q".repeat(43);

/** The app on the test's transaction, with a clock and a log of its own. */
async function appOf(ctx: TestContext) {
  const { logger, lines } = await captureLogger();
  return { app: createApp({ config: testConfig(), logger, db: ctx.client, now: () => AT }), lines };
}

/** A person, their one-click link and its secret. */
async function linkedAccount(ctx: TestContext) {
  const who = await signedInAccount(ctx.client);
  const link = (await unsubscribeLinkOf(ctx.client, BASE, who.accountId)) ?? "";
  return { who, link, token: link.slice(BASE.length) };
}

const ONE_CLICK = "List-Unsubscribe=One-Click";

/** What a mail app sends for the email's Unsubscribe (RFC 8058 §3.2). */
const click = (app: App, token: string, init: RequestInit = {}) =>
  app.request(`/mail/unsubscribe/${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: ONE_CLICK,
    ...init,
  });

async function announcementsOn(app: App, who: SignedIn) {
  const answer = await app.request("/account/notifications", { headers: who.headers });
  expect(answer.status).toBe(200);
  const { choices } = NotificationChoices.parse(await answer.json());
  return choices.find((choice) => choice.kind === "announcement")?.enabled;
}

/** The person's announcement choice as stored: none until somebody sets it. */
const storedChoice = async (ctx: TestContext, who: SignedIn) =>
  (
    await ctx.client.query<{ enabled: boolean; updated_at: Date }>(
      "SELECT enabled, updated_at FROM notification_preference WHERE account_id = $1 AND kind = 'announcement'",
      [who.accountId],
    )
  ).rows[0];

/** Makes `token` the person's secret, whatever its shape: only a test writes one by hand. */
const holdAs = (ctx: TestContext, who: SignedIn, token: string) =>
  ctx.client.query(
    `INSERT INTO unsubscribe_token (account_id, token) VALUES ($1, $2)
     ON CONFLICT (account_id) DO UPDATE SET token = EXCLUDED.token`,
    [who.accountId, token],
  );

describe("unsubscribeBase", () => {
  it.each([
    ["unset", undefined, undefined],
    ["empty", "", undefined],
    ["plain http, a developer's machine", "http://127.0.0.1:3000/auth/callback", undefined],
    [
      "https, its path and query left behind",
      "https://api.kumpa.fi/auth/callback?from=app",
      "https://api.kumpa.fi/mail/unsubscribe/",
    ],
    [
      "https on a port of its own",
      "https://api.example.test:8443/auth/callback",
      "https://api.example.test:8443/mail/unsubscribe/",
    ],
  ])("answers for a callback %s", (_, callback, expected) => {
    expect(unsubscribeBase({ OIDC_REDIRECT_URI: callback })).toBe(expected);
  });
});

describe("the secret", () => {
  test("is made once and answered the same ever after", async ({ ctx }) => {
    const who = await signedInAccount(ctx.client);
    expect(await repo.unsubscribeTokenOf(ctx.client, who.accountId, FRESH)).toBe(FRESH);
    expect(await repo.unsubscribeTokenOf(ctx.client, who.accountId, "r".repeat(43))).toBe(FRESH);
    const link = await unsubscribeLinkOf(ctx.client, BASE, who.accountId);
    expect(link).toBe(`${BASE}${FRESH}`);
  });

  test("is 256 random bits as base64url, and each account's its own", async ({ ctx }) => {
    const [a, b] = [await linkedAccount(ctx), await linkedAccount(ctx)];
    for (const { token } of [a, b]) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(a.token, "base64url")).toHaveLength(32);
    expect(a.token).not.toBe(b.token);
    expect(await unsubscribeLinkOf(ctx.client, BASE, a.who.accountId)).toBe(a.link);
  });

  test("is not made for an erased account", async ({ ctx }) => {
    const who = await signedInAccount(ctx.client);
    const { logger } = await captureLogger();
    await eraseAccount({ db: ctx.client, logger, now: () => AT }, who.accountId);
    expect(await repo.unsubscribeTokenOf(ctx.client, who.accountId, FRESH)).toBeNull();
    expect(await unsubscribeLinkOf(ctx.client, BASE, who.accountId)).toBeNull();
    const left = "SELECT count(*) AS n FROM unsubscribe_token WHERE account_id = $1";
    expect(await count(ctx, left, [who.accountId])).toBe(0);
  });

  test("goes with the erasure, and the export carries none", async ({ ctx }) => {
    const { who, token } = await linkedAccount(ctx);
    const exported = await exportOf(ctx.app, who.headers);
    expect(JSON.stringify(exported)).not.toContain(token);
    const { logger } = await captureLogger();
    await eraseAccount({ db: ctx.client, logger, now: () => AT }, who.accountId);
    const left = "SELECT count(*) AS n FROM unsubscribe_token WHERE account_id = $1";
    expect(await count(ctx, left, [who.accountId])).toBe(0);
  });
});

describe("POST /mail/unsubscribe/:token", () => {
  test("turns the person's announcements off, answers nothing, and logs the account, never the secret", async ({
    ctx,
  }) => {
    const { app, lines } = await appOf(ctx);
    const { who, token } = await linkedAccount(ctx);
    const answer = await click(app, token);
    expect(answer.status).toBe(200);
    expect(answer.headers.get("cache-control")).toBe("no-store");
    expect(answer.headers.get("location")).toBeNull();
    expect(await answer.text()).toBe("");
    expect(await storedChoice(ctx, who)).toEqual({ enabled: false, updated_at: AT });
    expect(await announcementsOn(app, who)).toBe(false);
    expect(lines()).toContainEqual(
      expect.objectContaining({ msg: "announcements unsubscribed", accountId: who.accountId }),
    );
    expect(JSON.stringify(lines())).not.toContain(token);
  });

  test("answers a second click as the first, and one after the switch went back on", async ({
    ctx,
  }) => {
    const { app } = await appOf(ctx);
    const { who, token } = await linkedAccount(ctx);
    expect((await click(app, token)).status).toBe(200);
    expect((await click(app, token)).status).toBe(200);
    expect(await announcementsOn(app, who)).toBe(false);
    const on = await app.request("/account/notifications/announcement", {
      method: "PUT",
      headers: json(who.headers),
      body: JSON.stringify({ enabled: true }),
    });
    expect(on.status).toBe(200);
    // An older email's link still works: the secret is kept as it is.
    expect((await click(app, token)).status).toBe(200);
    expect(await announcementsOn(app, who)).toBe(false);
  });

  const multipart = new FormData();
  multipart.set("List-Unsubscribe", "One-Click");
  test("decides by the link alone, whatever the body", async ({ ctx }) => {
    const { app } = await appOf(ctx);
    const bodies: [string, RequestInit][] = [
      ["multipart, as RFC 8058 asks", { body: multipart, headers: {} }],
      ["no body at all", { body: null, headers: {} }],
      ["other words", { body: "unsubscribe me", headers: { "content-type": "text/plain" } }],
    ];
    for (const [what, init] of bodies) {
      const { who, token } = await linkedAccount(ctx);
      expect((await click(app, token, init)).status, what).toBe(200);
      expect(await announcementsOn(app, who), what).toBe(false);
    }
  });

  test("turns off the link's person, whoever's session the request carries", async ({ ctx }) => {
    const { app } = await appOf(ctx);
    const a = await linkedAccount(ctx);
    const b = await signedInAccount(ctx.client);
    expect((await click(app, a.token, { headers: b.headers })).status).toBe(200);
    expect(await announcementsOn(app, a.who)).toBe(false);
    expect(await announcementsOn(app, b)).toBe(true);
  });

  test("answers 404 to a link nobody holds and to an erased account's", async ({ ctx }) => {
    const { app } = await appOf(ctx);
    const nobody = await click(app, FRESH);
    expect(nobody.status).toBe(404);
    const { who, token } = await linkedAccount(ctx);
    const { logger } = await captureLogger();
    await eraseAccount({ db: ctx.client, logger, now: () => AT }, who.accountId);
    expect((await click(app, token)).status).toBe(404);
  });

  // Each held as somebody's secret, which only a hand can write, so that the
  // shape is what refuses it.
  test("refuses a link of any other shape with 404, though somebody holds it", async ({ ctx }) => {
    const { app } = await appOf(ctx);
    const shapes: [string, string][] = [
      ["42 characters", "a".repeat(42)],
      ["44 characters", "a".repeat(44)],
      ["padded", `${"a".repeat(42)}=`],
      ["base64's plus", `${"a".repeat(42)}+`],
      ["a dot", `${"a".repeat(42)}.`],
      ["a letter outside ASCII", `${"a".repeat(42)}ä`],
      ["a space", `${"a".repeat(42)} `],
    ];
    const who = await signedInAccount(ctx.client);
    for (const [what, token] of shapes) {
      await holdAs(ctx, who, token);
      const answer = await click(app, token);
      expect(answer.status, what).toBe(404);
      expect(((await answer.json()) as { error: { code: string } }).error.code, what).toBe(
        "not_found",
      );
    }
    expect(await storedChoice(ctx, who)).toBeUndefined();
  });

  test("accepts every secret of 32 bytes, and refuses every other length", async ({ ctx }) => {
    const { app } = await appOf(ctx);
    const who = await signedInAccount(ctx.client);
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ minLength: 32, maxLength: 32 }), async (bytes) => {
        const token = Buffer.from(bytes).toString("base64url");
        await holdAs(ctx, who, token);
        expect((await click(app, token)).status).toBe(200);
      }),
      { seed: 196, numRuns: 40 },
    );
    await fc.assert(
      fc.asyncProperty(
        fc.stringMatching(/^[A-Za-z0-9_-]{1,96}$/).filter((token) => token.length !== 43),
        async (token) => {
          await holdAs(ctx, who, token);
          expect((await click(app, token)).status).toBe(404);
        },
      ),
      { seed: 196, numRuns: 40 },
    );
  });

  test("answers 500 when the database fails, and neither the log nor the report carries the secret", async ({
    ctx,
  }) => {
    const { who, token } = await linkedAccount(ctx);
    const { logger, lines } = await captureLogger();
    const reported: { error: unknown; route?: string }[] = [];
    // The click's one statement fails as a dropped connection would; every
    // other query reaches the test's transaction.
    const db = {
      query: (text: string, values?: unknown[]) =>
        text.includes("FROM unsubscribe_token u")
          ? Promise.reject(new Error("Connection terminated unexpectedly"))
          : ctx.client.query(text, values),
    } as typeof ctx.client;
    const app = createApp({
      config: testConfig(),
      logger,
      db,
      now: () => AT,
      report: (error, { route }) => reported.push({ error, route }),
    });
    const answer = await click(app, token);
    expect(answer.status).toBe(500);
    expect(answer.headers.get("cache-control")).toBe("no-store");
    expect(reported).toEqual([{ error: expect.any(Error), route: "/mail/unsubscribe/:token" }]);
    expect(lines()).toContainEqual(expect.objectContaining({ msg: "unhandled error" }));
    expect(lines()).not.toContainEqual(
      expect.objectContaining({ msg: "announcements unsubscribed" }),
    );
    expect(JSON.stringify([lines(), String(reported[0]?.error)])).not.toContain(token);
    expect(await storedChoice(ctx, who)).toBeUndefined();
  });
});

describe("GET /mail/unsubscribe/:token", () => {
  test("answers a GET or a HEAD 405, allowing POST, and changes nothing", async ({ ctx }) => {
    const { app } = await appOf(ctx);
    const { who, token } = await linkedAccount(ctx);
    for (const method of ["GET", "HEAD"]) {
      const answer = await app.request(`/mail/unsubscribe/${token}`, { method });
      expect(answer.status, method).toBe(405);
      expect(answer.headers.get("allow"), method).toBe("POST");
      expect(answer.headers.get("cache-control"), method).toBe("no-store");
      expect(await answer.text(), method).toBe("");
    }
    expect(await storedChoice(ctx, who)).toBeUndefined();
  });
});

// TD-7: a writer that meets an erasure under way waits for it, and writes
// only for an account that is still live once it ends.
describe("against an erasure under way", () => {
  it.each(["COMMIT", "ROLLBACK"] as const)(
    "the secret waits for erasure's %s and is made only for a live account",
    async (finish) => {
      await withErasureRace(
        finish,
        (db, accountId) => repo.unsubscribeTokenOf(db, accountId, FRESH),
        async (db, accountId, result) => {
          const { rows } = await db.query(
            "SELECT token FROM unsubscribe_token WHERE account_id = $1",
            [accountId],
          );
          expect(result).toBe(finish === "COMMIT" ? null : FRESH);
          expect(rows).toEqual(finish === "COMMIT" ? [] : [{ token: FRESH }]);
        },
      );
    },
  );

  it.each(["COMMIT", "ROLLBACK"] as const)(
    "a click waits for erasure's %s and turns off only a live account's switch",
    async (finish) => {
      await withErasureRace(
        finish,
        (db) => repo.unsubscribeByToken(db, FRESH, AT),
        async (db, accountId, result) => {
          const { rows } = await db.query(
            "SELECT enabled FROM notification_preference WHERE account_id = $1 AND kind = 'announcement'",
            [accountId],
          );
          expect(result).toBe(finish === "COMMIT" ? null : accountId);
          expect(rows).toEqual(finish === "COMMIT" ? [] : [{ enabled: false }]);
        },
        (db, accountId) => repo.unsubscribeTokenOf(db, accountId, FRESH),
      );
    },
  );
});
