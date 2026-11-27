import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// biome-ignore lint/style/noRestrictedImports: a test of the bar over the synthetic population.
import { generatePopulation, writePopulation } from "@kuutti/db/demo";
import { CONSENT_VERSIONS } from "@kuutti/i18n";
import {
  ErrorResponse,
  moveFigures,
  POND_COUNTER_K_MIN,
  type PondCounterCounts,
  PondCounterResponse,
  publishCounts,
  type SeeksBands,
} from "@kuutti/schema";
import fc from "fast-check";
import { it } from "vitest";
import { createApp } from "../app.ts";
import { takeSnapshot } from "../jobs/pond-counter.ts";
import { subjectsOfPond } from "../jobs/pool.ts";
import { signedInAccount, withMatchingConfig } from "../test/account.ts";
import {
  captureLogger,
  describe,
  expect,
  type TestContext,
  test,
  testConfig,
} from "../test/harness.ts";
import { HOME, people } from "../test/people.ts";
import { POND_COUNTER_CACHE_CONTROL } from "./routes.ts";

// features/pond/counter.feature (#54, ADR-013): what the public may read, and
// what a session adds to it. There is one pond, the country (ADR-061 §8, #607):
// a test's pond is everybody it wrote a home for, and its answer is one number.

const DAY = new Date("2026-10-05T01:00:00Z");
const NEXT_DAY = new Date("2026-10-06T01:00:00Z");
const DAY_AFTER = new Date("2026-10-07T01:00:00Z");

async function taken(ctx: TestContext, at = DAY) {
  const { logger } = await captureLogger();
  await takeSnapshot({ db: ctx.client, logger, now: () => at });
}

/** A signed-in person who has told their home, and stands in no band: they have no finished profile. */
async function personOf(ctx: TestContext) {
  const person = await signedInAccount(ctx.client);
  await ctx.client.query("UPDATE account SET home_place = $1 WHERE id = $2", [
    HOME,
    person.accountId,
  ]);
  return person;
}

const askBar = async (ctx: TestContext, headers: Record<string, string>) =>
  PondCounterResponse.parse(await (await ctx.app.request("/ponds/counter", { headers })).json())
    .seeks;

async function pondWithBands(ctx: TestContext, [men, everyone, women]: [number, number, number]) {
  const finished = { complete: true, consented: true };
  await people(ctx.client, men, { ...finished, seeks: ["man"] });
  await people(ctx.client, everyone, { ...finished, seeks: ["woman", "man"] });
  await people(ctx.client, women, { ...finished, seeks: ["woman"] });
}

/** What the public hears. */
const read = async (ctx: TestContext) =>
  PondCounterResponse.parse(await (await ctx.app.request("/ponds/counter")).json());

const numberOf = async (ctx: TestContext) => (await read(ctx)).finished;

describe("the bar of whom a pond seeks (#507)", () => {
  describe("The bar is said only when every band is at least k", () => {
    test.for([
      { men: 20, everyone: 10, women: 20, bar: { men: 40, everyone: 20, women: 40 } },
      { men: 15, everyone: 15, women: 15, bar: { men: 35, everyone: 30, women: 35 } },
      { men: 20, everyone: 9, women: 20, bar: null },
      { men: 20, everyone: 0, women: 20, bar: null },
      { men: 0, everyone: 20, women: 20, bar: null },
    ])("$men, $everyone, $women: $bar", async ({ men, everyone, women, bar }, { ctx }) => {
      await pondWithBands(ctx, [men, everyone, women]);
      const person = await personOf(ctx);
      await taken(ctx);
      expect(await askBar(ctx, person.headers)).toEqual(bar);
    });
  });

  test("The bar does not move with a number that moved by k", async ({ ctx }) => {
    await pondWithBands(ctx, [10, 10, 10]);
    const person = await personOf(ctx);
    await taken(ctx);
    const said = await askBar(ctx, person.headers);
    expect(said).toEqual({ men: 35, everyone: 30, women: 35 });
    expect(await numberOf(ctx)).toBe(30);
    await people(ctx.client, 9, { complete: true, consented: true, seeks: ["non_binary"] });
    await people(ctx.client, 1, { complete: true, consented: true, seeks: ["man"] });
    await taken(ctx, NEXT_DAY);
    expect(await numberOf(ctx)).toBe(40);
    // 40, 30 and 30 would say what the one who finished seeks, out loud.
    expect(await askBar(ctx, person.headers)).toEqual(said);
  });

  test("The bar moves once k finished profiles have come or gone", async ({ ctx }) => {
    await pondWithBands(ctx, [10, 10, 10]);
    const person = await personOf(ctx);
    // Everything a finished profile has, but for its second photo.
    const finishing = await people(ctx.client, 10, {
      complete: true,
      consented: true,
      seeks: ["man"],
      photos: 1,
    });
    await taken(ctx);
    const said = await askBar(ctx, person.headers);
    expect(said).toEqual({ men: 35, everyone: 30, women: 35 });
    const before = await read(ctx);
    expect(before).toMatchObject({ day: "2026-10-05", finished: 30 });
    // The second approved photo, as the helper writes the first.
    const finish = (ids: string[]) =>
      ctx.client.query(
        `INSERT INTO photo (account_id, key, blurhash, width, height, state, position)
         SELECT id, md5(id::text || 'second'), 'LEHV6nWB2yk8pyo0adR*.7kCMdnj', 800, 1067, 'approved', 1
         FROM unnest($1::uuid[]) AS id`,
        [ids],
      );
    await finish(finishing.slice(0, 9));
    await taken(ctx, NEXT_DAY);
    expect(await askBar(ctx, person.headers)).toEqual(said);
    expect(await read(ctx)).toEqual(before);

    await finish(finishing.slice(9));
    await taken(ctx, DAY_AFTER);
    expect(await askBar(ctx, person.headers)).toEqual({ men: 50, everyone: 25, women: 25 });
    expect(await read(ctx)).toMatchObject({ day: "2026-10-07", finished: 40 });
  });

  test("The bar moves once k people have changed band", async ({ ctx }) => {
    const finished = { complete: true, consented: true };
    const changing = await people(ctx.client, 20, { ...finished, seeks: ["man"] });
    await people(ctx.client, 10, { ...finished, seeks: ["woman", "man"] });
    await people(ctx.client, 10, { ...finished, seeks: ["woman"] });
    const person = await personOf(ctx);
    await taken(ctx);
    expect(await askBar(ctx, person.headers)).toEqual({ men: 50, everyone: 25, women: 25 });
    const before = await read(ctx);
    expect(before).toMatchObject({ day: "2026-10-05", finished: 40 });
    await ctx.client.query(
      `UPDATE preferences SET value = '["woman"]'
       WHERE field = 'seeks' AND account_id = ANY($1)`,
      [changing.slice(0, 10)],
    );
    await taken(ctx, NEXT_DAY);
    expect(await askBar(ctx, person.headers)).toEqual({ men: 25, everyone: 25, women: 50 });
    // Nothing in public says that it moved, not even the day.
    expect(await read(ctx)).toEqual(before);
  });

  test("The bar says shares of the caller's own pond and nothing else", async ({ ctx }) => {
    await pondWithBands(ctx, [20, 10, 20]);
    const mine = await personOf(ctx);
    await taken(ctx);

    const response = await ctx.app.request("/ponds/counter", { headers: mine.headers });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vary") ?? "").toMatch(/\bAuthorization\b/i);
    const text = await response.text();
    expect(PondCounterResponse.parse(JSON.parse(text))).toEqual({
      k: 10,
      day: "2026-10-05",
      finished: 50,
      seeks: { men: 40, everyone: 20, women: 40 },
    });
    expect(text).not.toContain(mine.accountId);
    expect(text).not.toMatch(/seeksMen|seeksEveryone|seeksWomen/);
  });

  test("Nobody hears a bar without a home or without a session", async ({ ctx }) => {
    await pondWithBands(ctx, [20, 10, 20]);
    const nobody = await signedInAccount(ctx.client);
    const somebody = await personOf(ctx);
    await taken(ctx);
    expect(await askBar(ctx, nobody.headers)).toBeNull();
    expect(await askBar(ctx, {})).toBeNull();
    // The bar is there to hear: a home is all that the first of them lacks.
    expect(await askBar(ctx, somebody.headers)).toEqual({ men: 40, everyone: 20, women: 40 });
  });

  test("A session that does not stand is refused, not answered as the public", async ({ ctx }) => {
    await pondWithBands(ctx, [20, 10, 20]);
    const expired = await personOf(ctx);
    const revoked = await personOf(ctx);
    await taken(ctx);
    await ctx.client.query(
      "UPDATE session SET access_expires_at = now() - interval '1 minute' WHERE id = $1",
      [expired.sessionId],
    );
    await ctx.client.query("UPDATE session SET revoked_at = now() WHERE id = $1", [
      revoked.sessionId,
    ]);
    const refusals = [
      [{ authorization: "Bearer not-a-session" }, "unauthenticated"],
      [{ authorization: "Basic a2V5OnZhbHVl" }, "unauthenticated"],
      [{ authorization: "" }, "unauthenticated"],
      [expired.headers, "session_expired"],
      [revoked.headers, "session_revoked"],
    ] as const;
    for (const [headers, code] of refusals) {
      const response = await ctx.app.request("/ponds/counter", { headers });
      expect(response.status).toBe(401);
      expect(ErrorResponse.parse(await response.json()).error.code).toBe(code);
      expect(response.headers.get("cache-control")).not.toBe(POND_COUNTER_CACHE_CONTROL);
    }
  });

  test("before the first count there is no bar", async ({ ctx }) => {
    await ctx.client.query("DELETE FROM pond_counter");
    await pondWithBands(ctx, [20, 10, 20]);
    const person = await personOf(ctx);
    expect(await askBar(ctx, person.headers)).toBeNull();
  });

  test("a row with its bands and the number at its default keeps its bar for a person with a home, with no number beside it, until the next count replaces both (#581)", async ({
    ctx,
  }) => {
    await pondWithBands(ctx, [10, 10, 10]);
    const person = await personOf(ctx);
    await taken(ctx);
    const said = await askBar(ctx, person.headers);
    expect(said).toEqual({ men: 35, everyone: 30, women: 35 });
    // The bands as they stood, and the number at its default.
    await ctx.client.query("UPDATE pond_counter SET finished = 0");
    expect(await read(ctx)).toMatchObject({ day: null, finished: null, seeks: null });
    expect(await askBar(ctx, person.headers)).toEqual(said);

    // Zero was never said, so no step holds the row back: one more finished is one more in a band.
    await people(ctx.client, 1, { complete: true, consented: true, seeks: ["man"] });
    await taken(ctx, NEXT_DAY);
    expect(await read(ctx)).toMatchObject({ day: "2026-10-06", finished: 31 });
    expect(await askBar(ctx, person.headers)).toEqual({ men: 40, everyone: 30, women: 30 });
  });

  test("a larger k says less, and a k below the floor no more", async ({ ctx }) => {
    await pondWithBands(ctx, [12, 12, 12]);
    const person = await personOf(ctx);
    await taken(ctx);
    await withMatchingConfig(ctx.client, { pond_counter_k: 13 });
    expect(await askBar(ctx, person.headers)).toBeNull();
    await withMatchingConfig(ctx.client, { pond_counter_k: 1 });
    expect(await askBar(ctx, person.headers)).not.toBeNull();
  });

  test("a failure is answered as a failure, not as a pond with no bar", async ({ ctx }) => {
    await pondWithBands(ctx, [12, 12, 12]);
    const person = await personOf(ctx);
    await taken(ctx);
    await withMatchingConfig(ctx.client, { pond_counter_k: "ten" });
    const response = await ctx.app.request("/ponds/counter", { headers: person.headers });
    expect(response.status).toBe(500);
  });

  test("the demo population fills the bar, and stays out of every pool and queue", {
    timeout: 60_000,
  }, async ({ ctx }) => {
    const population = generatePopulation({ homes: { [HOME]: 1 } });
    await writePopulation(ctx.client, population, CONSENT_VERSIONS);
    const person = await personOf(ctx);
    await taken(ctx);
    expect(await askBar(ctx, person.headers)).toEqual({ men: 35, everyone: 25, women: 40 });
    expect(await numberOf(ctx)).toBe(50);
    // Nobody here is a subject, so nobody is in a pool, on a card or in a queue.
    expect(await subjectsOfPond(ctx.client, DAY)).toEqual([]);
  });

  test("The public counter says nothing of whom anybody seeks", async ({ ctx }) => {
    await pondWithBands(ctx, [20, 10, 20]);
    const person = await personOf(ctx);
    await taken(ctx);
    expect(await askBar(ctx, person.headers)).not.toBeNull();
    const text = await (await ctx.app.request("/ponds/counter")).text();
    expect(text).not.toMatch(/everyone/i);
    const said = PondCounterResponse.parse(JSON.parse(text));
    expect(said.seeks).toBeNull();
    expect(Object.keys(said).sort()).toEqual(["day", "finished", "k", "seeks"]);
  });
});

describe("the counter", () => {
  test("A pond below k publishes no number", async ({ ctx }) => {
    await people(ctx.client, 9, { complete: true });
    await taken(ctx);
    expect(await read(ctx)).toEqual({ k: 10, day: null, finished: null, seeks: null });
  });

  test("is the same answer with a session and without: no number below k, the number at k (#581)", async ({
    ctx,
  }) => {
    await people(ctx.client, 9, { complete: true });
    const askers = [{}, (await personOf(ctx)).headers, (await signedInAccount(ctx.client)).headers];
    const heard = async () => {
      const answers = [];
      for (const headers of askers) {
        const response = await ctx.app.request("/ponds/counter", { headers });
        expect(response.status).toBe(200);
        answers.push(PondCounterResponse.parse(await response.json()));
      }
      return answers;
    };
    await taken(ctx);
    const below = { k: 10, day: null, finished: null, seeks: null };
    expect(await heard()).toEqual([below, below, below]);

    await people(ctx.client, 1, { complete: true });
    await taken(ctx, NEXT_DAY);
    const at = { k: 10, day: "2026-10-06", finished: 10, seeks: null };
    expect(await heard()).toEqual([at, at, at]);
  });

  test("The counter answers without a session and names nobody", async ({ ctx }) => {
    const ids = await people(ctx.client, 12, { gender: "woman", complete: true });
    const someone = await signedInAccount(ctx.client);
    await taken(ctx);
    const response = await ctx.app.request("/ponds/counter");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(POND_COUNTER_CACHE_CONTROL);
    const text = await response.text();
    const body = PondCounterResponse.parse(JSON.parse(text));
    expect(body).toEqual({ k: 10, day: "2026-10-05", finished: 12, seeks: null });
    // No pond is named, in any form: there is the one number (#500, #607).
    expect(text).not.toMatch(/pond|slug|suomi|parentId|nameInessive/i);
    for (const id of [...ids, someone.accountId]) expect(text).not.toContain(id);
    expect(text).not.toMatch(/T\d\d:\d\d/); // a day, never a time of day
    expect(text).not.toContain("Aino");
    expect(text).not.toContain("bio");
    // The same answer to a session with no home, which a cache may not keep: it is theirs.
    const signedIn = await ctx.app.request("/ponds/counter", { headers: someone.headers });
    expect(signedIn.headers.get("cache-control")).toBe("no-store");
    expect(await signedIn.text()).toBe(text);
  });

  test("The counter says one number and nothing of gender or of a profile that is not complete", async ({
    ctx,
  }) => {
    await people(ctx.client, 10, { gender: "woman", complete: true });
    await people(ctx.client, 10, { gender: "man", complete: true });
    await people(ctx.client, 10, { gender: "woman", complete: true, photos: 1 });
    await taken(ctx);
    const text = await (await ctx.app.request("/ponds/counter")).text();
    // Every field by name: a total of thirty, a split or the ten who have not finished has no place.
    expect(PondCounterResponse.parse(JSON.parse(text))).toEqual({
      k: 10,
      day: "2026-10-05",
      finished: 20,
      seeks: null,
    });
    expect(text).not.toMatch(/verified|split|finishing|wom[ae]n|\bm[ae]n\b|non.?binary|gender/i);
  });

  test("k comes from matching_config, and a larger k publishes less", async ({ ctx }) => {
    await people(ctx.client, 16, { complete: true });
    await taken(ctx);
    expect(await numberOf(ctx)).toBe(16);
    await withMatchingConfig(ctx.client, { pond_counter_k: 20 });
    expect(await read(ctx)).toEqual({ k: 20, day: null, finished: null, seeks: null });
  });

  test("a k below the floor in matching_config publishes nothing more: the floor holds", async ({
    ctx,
  }) => {
    await people(ctx.client, 9, { complete: true });
    await withMatchingConfig(ctx.client, { pond_counter_k: 1 });
    await taken(ctx);
    expect(await read(ctx)).toEqual({ k: 10, day: null, finished: null, seeks: null });
  });

  test("a failure is not answered as something a cache may keep", async ({ ctx }) => {
    await withMatchingConfig(ctx.client, { pond_counter_k: "ten" });
    const response = await ctx.app.request("/ponds/counter");
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBeNull();
  });

  test("the published contract holds the floor too: no number under ten, and nothing that accepts anything", () => {
    const document = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../../openapi.json"), "utf8"),
    ) as { components: { schemas: Record<string, { properties: Record<string, unknown> }> } };
    const answer = document.components.schemas.PondCounterResponse?.properties ?? {};
    expect(Object.keys(answer).sort()).toEqual(["day", "finished", "k", "seeks"]);
    expect(answer.finished).toEqual({ type: "integer", nullable: true, minimum: 10 });
    expect(document.components.schemas.PondCounterSplit).toBeUndefined();
    // One number, with no list of ponds around it (#607).
    expect(document.components.schemas.PondCounterPond).toBeUndefined();
    // A schema without a type accepts anything, and the generated client type says `unknown`.
    const generated = readFileSync(
      resolve(import.meta.dirname, "../../../../packages/schema/src/api.generated.ts"),
      "utf8",
    );
    expect(generated).toMatch(/finished: number \| null;/);
    expect(generated).not.toMatch(/PondCounterSplit|PondCounterPond/);
  });

  test("before any figures exist the answer has no number and no day", async ({ ctx }) => {
    await ctx.client.query("DELETE FROM pond_counter");
    await people(ctx.client, 30, { complete: true });
    expect(await read(ctx)).toEqual({ k: 10, day: null, finished: null, seeks: null });
  });

  test("a browser origin is answered only from the allowlist, and caches are told the answer varies by it", async ({
    ctx,
  }) => {
    const { logger } = await captureLogger();
    const app = createApp({
      config: testConfig({ CORS_ALLOWED_ORIGINS: "https://kuutti.app" }),
      logger,
      db: ctx.client,
    });
    const site = await app.request("/ponds/counter", { headers: { origin: "https://kuutti.app" } });
    expect(site.headers.get("access-control-allow-origin")).toBe("https://kuutti.app");
    const other = await app.request("/ponds/counter", {
      headers: { origin: "https://scraper.example" },
    });
    expect(other.status).toBe(200);
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
    const none = await app.request("/ponds/counter");
    // The answer is cacheable, so every form of it must say what it varies by:
    // a cache that kept the site's answer must not hand its header to another
    // origin, nor the public answer to somebody who asks with a session.
    for (const response of [site, other, none]) {
      expect(response.headers.get("cache-control")).toBe(POND_COUNTER_CACHE_CONTROL);
      expect(response.headers.get("vary") ?? "").toMatch(/\bOrigin\b/i);
      expect(response.headers.get("vary") ?? "").toMatch(/\bAuthorization\b/i);
    }
  });
});

// The two rules of packages/schema over any counts. Here because fast-check is
// this package's, and packages/schema keeps to zod (rules/schema.md).
describe("the rules over any counts (#581)", () => {
  const SEEDED = { seed: 20261104 };
  const NO_BANDS = { seeksMen: 0, seeksEveryone: 0, seeksWomen: 0 };
  /** Tonight's k, under the floor as a broken row of the config would be. */
  const anyK = fc.integer({ min: -5, max: 60 });
  const stepOf = (k: number) => Math.max(k, POND_COUNTER_K_MIN);
  /** A figure about where `n` is, or about a step from it either way, and never below zero. */
  const around = (n: number, step: number) =>
    fc.oneof(
      ...[n - step, n, n + step].map((at) =>
        fc.integer({ min: Math.max(0, at - 2), max: Math.max(0, at + 2) }),
      ),
    );
  /** Tonight's k, the row that stands, and tonight's count: on either side of a step, often. */
  const nights = anyK.chain((k) =>
    fc
      .record({
        finished: fc.nat(200),
        seeksMen: fc.nat(60),
        seeksEveryone: fc.nat(60),
        seeksWomen: fc.nat(60),
      })
      .chain((standing) =>
        fc
          .record({
            finished: around(standing.finished, stepOf(k)),
            seeksMen: around(standing.seeksMen, stepOf(k)),
            seeksEveryone: around(standing.seeksEveryone, stepOf(k)),
            seeksWomen: around(standing.seeksWomen, stepOf(k)),
          })
          .map((today) => ({ k, standing, today })),
      ),
  );
  const bandsOf = ({ seeksMen, seeksEveryone, seeksWomen }: SeeksBands) => ({
    seeksMen,
    seeksEveryone,
    seeksWomen,
  });
  /** How few people a difference of bands can speak of: those who rose, or those who fell. */
  const peopleBehind = (a: SeeksBands, b: SeeksBands) => {
    const moves = [
      b.seeksMen - a.seeksMen,
      b.seeksEveryone - a.seeksEveryone,
      b.seeksWomen - a.seeksWomen,
    ];
    const rose = moves.filter((n) => n > 0).reduce((sum, n) => sum + n, 0);
    const fell = moves.filter((n) => n < 0).reduce((sum, n) => sum - n, 0);
    return Math.max(rose, fell);
  };

  it("publishCounts says the number exactly from a k at or over the floor, and never what the contract would refuse", () => {
    // The whole column's range, and often about k itself.
    const kAndCount = anyK.chain((k) =>
      fc
        .oneof(around(Math.max(k, 0), 0), fc.integer({ min: 0, max: 2 ** 31 - 1 }))
        .map((finished) => ({ k, finished })),
    );
    fc.assert(
      fc.property(kAndCount, ({ k, finished }) => {
        const said = publishCounts({ finished, ...NO_BANDS }, k);
        expect(said).toBe(k >= POND_COUNTER_K_MIN && finished >= k ? finished : null);
        expect(PondCounterResponse.shape.finished.safeParse(said).success).toBe(true);
      }),
      SEEDED,
    );
  });

  it("publishCounts fails closed on a k that is not whole and on a count that cannot be", () => {
    // Over the floor and under the count too, where only its being a fraction refuses it.
    const notWhole = fc.oneof(
      fc.double({ min: 10, max: 70, noInteger: true }),
      fc.double({ noInteger: true }),
    );
    fc.assert(
      fc.property(
        notWhole,
        fc.integer({ min: -1000, max: -1 }),
        fc.integer({ min: 70, max: 2 ** 31 - 1 }),
        (broken, negative, whole) => {
          expect(publishCounts({ finished: whole, ...NO_BANDS }, broken)).toBeNull();
          expect(publishCounts({ finished: broken, ...NO_BANDS }, 10)).toBeNull();
          expect(publishCounts({ finished: negative, ...NO_BANDS }, 10)).toBeNull();
        },
      ),
      SEEDED,
    );
  });

  it("moveFigures takes today's figures at once when none stand, or when those that stand were never said", () => {
    fc.assert(
      fc.property(nights, ({ k, standing, today }) => {
        expect(moveFigures(null, today, k)).toBe(today);
        const never: PondCounterCounts = {
          ...standing,
          finished: standing.finished % POND_COUNTER_K_MIN,
        };
        expect(moveFigures(never, today, k)).toEqual(today);
      }),
      SEEDED,
    );
  });

  it("moveFigures moves the number by at least k or not at all, and takes it once it has", () => {
    fc.assert(
      fc.property(nights, ({ k, standing, today }) => {
        fc.pre(standing.finished >= POND_COUNTER_K_MIN);
        const moved = Math.abs(today.finished - standing.finished);
        expect(moveFigures(standing, today, k).finished).toBe(
          moved >= stepOf(k) ? today.finished : standing.finished,
        );
      }),
      SEEDED,
    );
  });

  it("moveFigures moves the bands whole, by at least k people or not at all, whatever the number does", () => {
    fc.assert(
      fc.property(nights, ({ k, standing, today }) => {
        fc.pre(standing.finished >= POND_COUNTER_K_MIN);
        const far = peopleBehind(standing, today) >= stepOf(k);
        expect(bandsOf(moveFigures(standing, today, k))).toEqual(bandsOf(far ? today : standing));
      }),
      SEEDED,
    );
  });

  it("moveFigures never lets what is said move by fewer than k people, and repeats it for the same count", () => {
    fc.assert(
      fc.property(nights, ({ k, standing, today }) => {
        fc.pre(k >= POND_COUNTER_K_MIN);
        const next = moveFigures(standing, today, k);
        const before = publishCounts(standing, k);
        const after = publishCounts(next, k);
        if (before !== null && after !== null) {
          expect(after === before || Math.abs(after - before) >= k).toBe(true);
        }
        expect(publishCounts(moveFigures(next, today, k), k)).toBe(after);
      }),
      SEEDED,
    );
  });
});
