import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect } from "vitest";
import { createApp } from "../app.ts";
import { captureLogger, test, testConfig } from "../test/harness.ts";
import {
  ANDROID_PACKAGE,
  INVITATION_PATHS,
  IOS_BUNDLE_ID,
  RETURN_PATH,
  verifiedReturns,
} from "./links.ts";

// The verified-links files (#36): shape and headers as Google and Apple read
// them, and 404 until the environment has the values. Then the return's own
// address (#184, ADR-074): which platform gets the https one, and where the
// API sends a browser that kept it.

const FINGERPRINT = Array.from({ length: 32 }, (_, i) => (i * 7 + 3).toString(16).padStart(2, "0"))
  .join(":")
  .toUpperCase();

const TEAM = "HM4J7X495K";
/** A one-time code's shape: 32 bytes as base64url, with both of its odd characters. */
const CODE = `${"aZ09_-".repeat(7)}Q`;

async function appAndLogs(ctx: { client: Parameters<typeof createApp>[0]["db"] }, overrides = {}) {
  const { logger, lines } = await captureLogger();
  return { app: createApp({ config: testConfig(overrides), logger, db: ctx.client }), lines };
}

async function appWith(ctx: { client: Parameters<typeof createApp>[0]["db"] }, overrides = {}) {
  return (await appAndLogs(ctx, overrides)).app;
}

describe("verified links", () => {
  test("assetlinks.json names the package and every configured fingerprint", async ({ ctx }) => {
    const app = await appWith(ctx, {
      ANDROID_CERT_FINGERPRINTS: `${FINGERPRINT.toLowerCase()} , ${FINGERPRINT}`,
    });
    const res = await app.request("/.well-known/assetlinks.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(await res.json()).toEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: ANDROID_PACKAGE,
          sha256_cert_fingerprints: [FINGERPRINT, FINGERPRINT],
        },
      },
    ]);
  });

  test("the AASA names the team, the bundle and the two paths the app takes, as application/json", async ({
    ctx,
  }) => {
    const app = await appWith(ctx, { IOS_TEAM_ID: TEAM });
    const res = await app.request("/.well-known/apple-app-site-association");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
    const body = await res.json();
    expect(body.applinks.details).toHaveLength(1);
    expect(body.applinks.details[0].appIDs).toEqual([`${TEAM}.${IOS_BUNDLE_ID}`]);
    // The return exactly, so that no other path under /auth opens the app,
    // and an invitation's link only with a code: /i alone stays the store's.
    expect(
      body.applinks.details[0].components.map((component: { "/": string }) => component["/"]),
    ).toEqual(["/auth/return", "/i/*"]);
  });

  test("both answer 404 until the environment has the values; a malformed value fails the boot", async ({
    ctx,
  }) => {
    const app = await appWith(ctx);
    expect((await app.request("/.well-known/assetlinks.json")).status).toBe(404);
    expect((await app.request("/.well-known/apple-app-site-association")).status).toBe(404);
    expect(() => testConfig({ ANDROID_CERT_FINGERPRINTS: "AB:CD" })).toThrow(/fingerprints/);
    expect(() => testConfig({ IOS_TEAM_ID: "short" })).toThrow(/ten characters/);
  });

  test("the return has an https address only for a platform whose file is served, on the registered callback's host", () => {
    const callback = "https://api.test/auth/callback?left=behind#too";
    const both = { ANDROID_CERT_FINGERPRINTS: FINGERPRINT, IOS_TEAM_ID: TEAM };
    expect(verifiedReturns({ OIDC_REDIRECT_URI: callback, ...both })).toEqual({
      android: "https://api.test/auth/return",
      ios: "https://api.test/auth/return",
    });
    expect(
      verifiedReturns({ OIDC_REDIRECT_URI: callback, ANDROID_CERT_FINGERPRINTS: FINGERPRINT }),
    ).toEqual({ android: "https://api.test/auth/return" });
    expect(verifiedReturns({ OIDC_REDIRECT_URI: callback, IOS_TEAM_ID: TEAM })).toEqual({
      ios: "https://api.test/auth/return",
    });
    expect(verifiedReturns({ OIDC_REDIRECT_URI: callback })).toEqual({});
    // Fingerprints that are only separators are none.
    expect(
      verifiedReturns({ OIDC_REDIRECT_URI: callback, ANDROID_CERT_FINGERPRINTS: " , " }),
    ).toEqual({});
    // No bank configured: nothing returns, so nothing has an address.
    expect(verifiedReturns(both)).toEqual({});
    // A callback in the clear, a developer's own computer: no phone verifies such a link.
    expect(
      verifiedReturns({ OIDC_REDIRECT_URI: "http://localhost:3000/auth/callback", ...both }),
    ).toEqual({});
    // A staff login is no platform of the app's.
    expect(verifiedReturns({ OIDC_REDIRECT_URI: callback, ...both }).admin).toBeUndefined();
  });
});

describe("what the app's build claims (apps/mobile/app.json)", () => {
  type Claim = { scheme?: string; host?: string; path?: string; pathPrefix?: string };
  const { expo } = JSON.parse(
    readFileSync(new URL("../../../mobile/app.json", import.meta.url), "utf8"),
  ) as {
    expo: {
      ios: { bundleIdentifier: string; associatedDomains: string[] };
      android: {
        package: string;
        intentFilters: {
          action: string;
          autoVerify?: boolean;
          category: string[];
          data: Claim[];
        }[];
      };
    };
  };
  // Both names of both environments, until the old one retires (ADR-072 §1, §8).
  const HOSTS = [
    "api.kumpa.fi",
    "api.kuutti.app",
    "api.staging.kumpa.fi",
    "api.staging.kuutti.app",
  ];

  test("is the app the two files name", () => {
    expect(expo.android.package).toBe(ANDROID_PACKAGE);
    expect(expo.ios.bundleIdentifier).toBe(IOS_BUNDLE_ID);
  });

  test("on an iPhone: the links of the four hosts, and nothing else of theirs", () => {
    expect(expo.ios.associatedDomains).toEqual(HOSTS.map((host) => `applinks:${host}`));
  });

  test("on Android: one verified filter, the return exactly and an invitation's link on each host", () => {
    expect(expo.android.intentFilters).toHaveLength(1);
    const [filter] = expo.android.intentFilters;
    expect(filter).toMatchObject({ action: "VIEW", autoVerify: true });
    expect([...(filter?.category ?? [])].sort()).toEqual(["BROWSABLE", "DEFAULT"]);
    // Android reads one filter's data as every host with every path, so each
    // host has to carry both, and nothing may ride along.
    expect(filter?.data).toEqual(
      HOSTS.flatMap((host) => [
        { scheme: "https", host, path: RETURN_PATH },
        { scheme: "https", host, pathPrefix: INVITATION_PATHS.replace(/\*$/, "") },
      ]),
    );
    expect(INVITATION_PATHS).toBe("/i/*");
  });
});

describe("the return a browser kept", () => {
  test("a code goes on to the app's scheme, uncached, and reaches no log line", async ({ ctx }) => {
    const { app, lines } = await appAndLogs(ctx);
    const res = await app.request(`/auth/return?code=${CODE}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`kuutti://auth?code=${CODE}`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe("");
    const request = lines().find((line) => line.msg === "request");
    expect(request).toMatchObject({ method: "GET", route: "/auth/return", status: 302 });
    expect(JSON.stringify(lines())).not.toContain(CODE);
  });

  test.for([
    ["no code", ""],
    ["an empty code", "?code="],
    ["a code one character short", `?code=${CODE.slice(1)}`],
    ["a code one character long", `?code=${CODE}A`],
    ["a code with a character of no code", `?code=${CODE.slice(1)}.`],
    ["a code that would write a second parameter", `?code=${CODE.slice(7)}%26error`],
    ["a link in the code's place", `?code=${encodeURIComponent("https://evil.test/auth/return")}`],
    ["a refusal somebody wrote", "?error=auth_banned&reason=scam&until=2099-01-01"],
  ])(
    "%s goes on as the refusal every bad code gets, never a JSON page",
    async ([, query], { ctx }) => {
      const { app, lines } = await appAndLogs(ctx);
      const res = await app.request(`/auth/return${query}`);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("kuutti://auth?error=auth_code_used");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("content-type")).toBeNull();
      // Nothing of what was sent is repeated, in the answer or in a line.
      expect(JSON.stringify(lines())).not.toMatch(/evil|scam|2099/);
    },
  );

  test("of two codes the first is read, as a browser's address bar would have it", async ({
    ctx,
  }) => {
    const app = await appWith(ctx);
    const res = await app.request(`/auth/return?code=${CODE}&code=${"B".repeat(43)}`);
    expect(res.headers.get("location")).toBe(`kuutti://auth?code=${CODE}`);
  });

  test("whatever stands in the code's place, the answer is that very code or the one refusal", async ({
    ctx,
  }) => {
    // Room for every run: the address's own limit is ADR-026's, held by its tests.
    const app = await appWith(ctx, { RATE_LIMIT_PER_MINUTE: 1000 });
    const sent = fc.oneof(
      fc.string({ maxLength: 120 }),
      fc.string({ unit: "binary", maxLength: 60 }),
      fc.stringMatching(/^[A-Za-z0-9_-]{40,46}$/),
      fc.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    );
    await fc.assert(
      fc.asyncProperty(sent, async (code) => {
        const res = await app.request(`/auth/return?code=${encodeURIComponent(code)}`);
        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe(
          /^[A-Za-z0-9_-]{43}$/.test(code)
            ? `kuutti://auth?code=${code}`
            : "kuutti://auth?error=auth_code_used",
        );
      }),
      { seed: 20261117, numRuns: 300 },
    );
  });

  test("it is a door of its own: no session asked, and only GET", async ({ ctx }) => {
    const app = await appWith(ctx);
    const res = await app.request(`/auth/return?code=${CODE}`, {
      headers: { authorization: "Bearer nobody" },
    });
    expect(res.status).toBe(302);
    expect((await app.request(`/auth/return?code=${CODE}`, { method: "POST" })).status).toBe(404);
  });
});
