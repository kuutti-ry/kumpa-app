import {
  CHANNEL_NAME_PATTERN,
  INVITATION_CODE_PATTERN,
  normaliseInvitationCode,
} from "@kuutti/schema";
import fc from "fast-check";
import { createApp } from "../app.ts";
import { captureLogger, describe, expect, test, testConfig } from "../test/harness.ts";
import { hashOf, invitationOf } from "../test/invitations.ts";
import { people } from "../test/people.ts";
import { SITE_URL } from "./link.ts";

// The one link (#574, ADR-044 §13): a phone goes to its own store by the
// User-Agent, anything else to the website, and the code is never looked up.

const APP_STORE = "https://apps.apple.com/app/id6700000000";
const PLAY = "https://play.google.com/store/apps/details?id=fi.kumpa";
const STORES = { APP_STORE_URL: APP_STORE, PLAY_STORE_URL: PLAY };

const UA = {
  iPhone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  iPad: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  iPod: "Mozilla/5.0 (iPod touch; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  android:
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  desktop:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
};

async function appWith(ctx: { client: Parameters<typeof createApp>[0]["db"] }, overrides = {}) {
  const captured = await captureLogger();
  const app = createApp({ config: testConfig(overrides), logger: captured.logger, db: ctx.client });
  return { app, lines: captured.lines };
}

async function follow(app: Awaited<ReturnType<typeof appWith>>["app"], path: string, ua?: string) {
  const res = await app.request(path, { headers: ua === undefined ? {} : { "user-agent": ua } });
  return { status: res.status, location: res.headers.get("location"), res };
}

describe("the one link", () => {
  test.for([
    ["an iPhone", UA.iPhone, APP_STORE],
    ["an iPad that says so", UA.iPad, APP_STORE],
    ["an iPod, whose User-Agent says iPhone OS", UA.iPod, APP_STORE],
    ["an Android phone", UA.android, PLAY],
    ["a computer", UA.desktop, SITE_URL],
    ["a caller that names nothing", undefined, SITE_URL],
  ] as const)("/i sends %s to its place, uncached", async ([, ua, place], { ctx }) => {
    const { app } = await appWith(ctx, STORES);
    const { status, location, res } = await follow(app, "/i", ua);
    expect(status).toBe(302);
    expect(location).toBe(place);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe("");
  });

  test("an Android phone takes the code to Play as the install referrer, as the API reads a code", async ({
    ctx,
  }) => {
    const { app } = await appWith(ctx, STORES);
    const { location } = await follow(app, "/i/abcde-fghjk", UA.android);
    const url = new URL(location ?? "");
    expect(`${url.origin}${url.pathname}`).toBe("https://play.google.com/store/apps/details");
    expect(url.searchParams.get("id")).toBe("fi.kumpa");
    expect(url.searchParams.get("referrer")).toBe("ABCDEFGHJK");
  });

  test.for([
    ["too short", "ABCDE"],
    ["too long", "ABCDE-FGHJK-M"],
    ["a letter Crockford leaves out", "ABCDE-FGHJU"],
  ] as const)(
    "a path that is no code (%s) goes to Play with no referrer",
    async ([, path], { ctx }) => {
      const { app } = await appWith(ctx, STORES);
      const { status, location } = await follow(app, `/i/${path}`, UA.android);
      expect(status).toBe(302);
      expect(location).toBe(PLAY);
    },
  );

  test("an iPhone and a computer get the same place with a code as without", async ({ ctx }) => {
    const { app } = await appWith(ctx, STORES);
    expect((await follow(app, "/i/ABCDE-FGHJK", UA.iPhone)).location).toBe(APP_STORE);
    expect((await follow(app, "/i/ABCDE-FGHJK", UA.desktop)).location).toBe(SITE_URL);
  });

  test("with no listing yet every phone goes to the website", async ({ ctx }) => {
    const { app } = await appWith(ctx);
    for (const ua of [UA.iPhone, UA.android]) {
      expect((await follow(app, "/i/ABCDE-FGHJK", ua)).location).toBe(SITE_URL);
    }
  });

  test("a code that is somebody's invitation is answered as one that is nobody's", async ({
    ctx,
  }) => {
    const [inviter] = await people(ctx.client, 1);
    await invitationOf(ctx.client, inviter as string, { codeHash: hashOf("ABCDEFGHJK") });
    const { app } = await appWith(ctx, STORES);
    const real = new URL((await follow(app, "/i/ABCDE-FGHJK", UA.android)).location ?? "");
    const none = new URL((await follow(app, "/i/ZZZZZ-ZZZZZ", UA.android)).location ?? "");
    expect(real.searchParams.get("referrer")).toBe("ABCDEFGHJK");
    expect(none.searchParams.get("referrer")).toBe("ZZZZZZZZZZ");
    real.searchParams.delete("referrer");
    none.searchParams.delete("referrer");
    expect(real.toString()).toBe(none.toString());
  });

  test("the request's log line names the route, never the code", async ({ ctx }) => {
    const { app, lines } = await appWith(ctx, STORES);
    await follow(app, "/i/ABCDE-FGHJK", UA.android);
    const logged = JSON.stringify(lines());
    expect(logged).toContain("/i/:code");
    expect(logged).not.toMatch(/ABCDE|FGHJK/);
  });
});

// A channel on the one link (#653, ADR-044 §13): the stores count installs per
// link on their side, and Kuutti keeps nothing.

const TOKEN = "118302700";
const TAGGED = { ...STORES, APP_STORE_PROVIDER_TOKEN: TOKEN };
const THIRTY = `${"a".repeat(29)}1`;

function queryOf(location: string | null) {
  const url = new URL(location ?? "");
  return { base: `${url.origin}${url.pathname}`, query: Object.fromEntries(url.searchParams) };
}

describe("a channel on the one link", () => {
  test("an iPhone goes to the App Store with Apple's campaign tokens", async ({ ctx }) => {
    const { app } = await appWith(ctx, TAGGED);
    const { status, location } = await follow(app, "/i?from=channel-7", UA.iPhone);
    expect(status).toBe(302);
    expect(queryOf(location)).toEqual({
      base: APP_STORE,
      query: { pt: TOKEN, ct: "channel-7", mt: "8" },
    });
  });

  test("an iPhone goes to the App Store untagged while there is no provider token", async ({
    ctx,
  }) => {
    const { app } = await appWith(ctx, STORES);
    expect((await follow(app, "/i?from=channel-7", UA.iPhone)).location).toBe(APP_STORE);
  });

  test("an Android phone goes to Play with the channel as the UTM source inside the referrer", async ({
    ctx,
  }) => {
    const { app } = await appWith(ctx, TAGGED);
    const { status, location } = await follow(app, "/i?from=channel-7", UA.android);
    expect(status).toBe(302);
    expect(location).toBe(`${PLAY}&referrer=utm_source%3Dchannel-7`);
  });

  test("a computer goes to the website, and so does every phone with no listing yet", async ({
    ctx,
  }) => {
    const listed = await appWith(ctx, TAGGED);
    expect((await follow(listed.app, "/i?from=channel-7", UA.desktop)).location).toBe(SITE_URL);
    const unlisted = await appWith(ctx, { APP_STORE_PROVIDER_TOKEN: TOKEN });
    for (const ua of [UA.iPhone, UA.android]) {
      expect((await follow(unlisted.app, "/i?from=channel-7", ua)).location).toBe(SITE_URL);
    }
  });

  test.for([
    ["one character", "a"],
    ["thirty characters", THIRTY],
    ["digits and hyphens alone", "2027-01"],
  ] as const)("a name of %s is taken", async ([, name], { ctx }) => {
    const { app } = await appWith(ctx, TAGGED);
    expect(queryOf((await follow(app, `/i?from=${name}`, UA.iPhone)).location).query.ct).toBe(name);
    expect(
      queryOf((await follow(app, `/i?from=${name}`, UA.android)).location).query.referrer,
    ).toBe(`utm_source=${name}`);
  });

  test.for([
    ["empty", "from="],
    ["thirty-one characters", `from=${THIRTY}x`],
    ["in capitals", "from=Channel"],
    ["with a space", "from=channel%207"],
    ["with an underscore", "from=channel_7"],
    ["with a letter outside a to z", "from=k%C3%A4vely"],
    ["carrying a referrer of its own", "from=x%26referrer%3DABCDEFGHJK"],
    ["carrying a store's token of its own", "from=x%26pt%3D1"],
  ] as const)(
    "a name that is %s is dropped, and the phone goes to its store untagged",
    async ([, query], { ctx }) => {
      const { app } = await appWith(ctx, TAGGED);
      expect((await follow(app, `/i?${query}`, UA.iPhone)).location).toBe(APP_STORE);
      expect((await follow(app, `/i?${query}`, UA.android)).location).toBe(PLAY);
    },
  );

  test("a query that is not from changes nothing", async ({ ctx }) => {
    const { app } = await appWith(ctx, TAGGED);
    expect((await follow(app, "/i?ct=x&pt=1&referrer=ABCDEFGHJK", UA.iPhone)).location).toBe(
      APP_STORE,
    );
    expect((await follow(app, "/i?ct=x&pt=1&referrer=ABCDEFGHJK", UA.android)).location).toBe(PLAY);
  });

  test("a channel never rides beside a code: the code goes on, the channel is dropped", async ({
    ctx,
  }) => {
    const { app } = await appWith(ctx, TAGGED);
    expect((await follow(app, "/i/ABCDE-FGHJK?from=channel-7", UA.iPhone)).location).toBe(
      APP_STORE,
    );
    expect((await follow(app, "/i/ABCDE-FGHJK?from=channel-7", UA.android)).location).toBe(
      `${PLAY}&referrer=ABCDEFGHJK`,
    );
    expect((await follow(app, "/i/ABCDE?from=channel-7", UA.android)).location).toBe(PLAY);
  });

  test("the referrer a channel takes to Play never reads as a code, whatever the name", async ({
    ctx,
  }) => {
    // Names such as `abcde-fghjk` read as a code on their own; the route's
    // `utm_source=` is what keeps them out of the app's code field. The runs and
    // a failure's shrinking are more requests than one address's minute allows.
    const { app } = await appWith(ctx, { ...TAGGED, RATE_LIMIT_PER_MINUTE: 10_000 });
    await fc.assert(
      fc.asyncProperty(fc.stringMatching(CHANNEL_NAME_PATTERN), async (channel) => {
        const { location } = await follow(app, `/i?from=${channel}`, UA.android);
        const referrer = new URL(location ?? "").searchParams.get("referrer") ?? "";
        expect(INVITATION_CODE_PATTERN.test(normaliseInvitationCode(referrer))).toBe(false);
        expect(referrer).toBe(`utm_source=${channel}`);
      }),
      { seed: 20261128 },
    );
  });

  test("the request's log line names the route, never the channel", async ({ ctx }) => {
    const { app, lines } = await appWith(ctx, TAGGED);
    await follow(app, "/i?from=channel-7", UA.iPhone);
    await follow(app, "/i?from=channel-7", UA.android);
    const logged = JSON.stringify(lines());
    expect(logged).toContain('"/i"');
    expect(logged).not.toContain("channel-7");
  });
});

describe("the stores' addresses", () => {
  test.for([
    ["APP_STORE_URL", "http://apps.apple.com/app/id1"],
    ["PLAY_STORE_URL", "not an address"],
  ] as const)("%s refuses anything but https", ([key, value]) => {
    expect(() => testConfig({ [key]: value })).toThrow(key);
  });

  test.for([
    ["empty", ""],
    ["with a space", "1183 02700"],
    ["with a query of its own", "1&ct=x"],
    ["longer than forty", "1".repeat(41)],
  ] as const)("APP_STORE_PROVIDER_TOKEN refuses one that is %s", ([, value]) => {
    expect(() => testConfig({ APP_STORE_PROVIDER_TOKEN: value })).toThrow(
      "APP_STORE_PROVIDER_TOKEN",
    );
  });

  test("APP_STORE_PROVIDER_TOKEN takes letters and digits, forty at most", () => {
    for (const value of ["1", "abcXYZ123", "1".repeat(40)]) {
      expect(testConfig({ APP_STORE_PROVIDER_TOKEN: value }).APP_STORE_PROVIDER_TOKEN).toBe(value);
    }
  });

  test("APP_STORE_PROVIDER_TOKEN is read without a file's newline", () => {
    expect(testConfig({ APP_STORE_PROVIDER_TOKEN: " 118302700\n" }).APP_STORE_PROVIDER_TOKEN).toBe(
      "118302700",
    );
  });
});
