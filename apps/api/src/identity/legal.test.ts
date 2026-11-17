import { CONSENT_VERSIONS, type LegalTextKind, legalLinkPath, legalPageUrl } from "@kuutti/i18n";
import { createApp } from "../app.ts";
import { captureLogger, describe, expect, test, testConfig } from "../test/harness.ts";

// The app's links to the legal texts (#208, ADR-010 §4): the API sends the
// browser on to the website's page, and the browser keeps the anchor.

async function appWith(ctx: { client: Parameters<typeof createApp>[0]["db"] }) {
  const captured = await captureLogger();
  return createApp({ config: testConfig(), logger: captured.logger, db: ctx.client });
}

describe("the legal texts' links", () => {
  test.for([
    ["/legal/terms", "https://kumpa.fi/legal/terms/"],
    ["/legal/privacy", "https://kumpa.fi/legal/privacy/"],
  ] as const)(
    "%s goes to the website's page, with no session and nothing kept",
    async ([path, site], { ctx }) => {
      const app = await appWith(ctx);
      const res = await app.request(path);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(site);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
      expect(await res.text()).toBe("");
    },
  );

  // What the phone opens is the API's path with the version's anchor; the
  // browser adds that anchor to where the API sends it, which has to be the
  // address the site publishes for the version (`pnpm check:legal-versions`).
  test("each kind's link in the app lands on the site's text at its version", async ({ ctx }) => {
    const app = await appWith(ctx);
    const kinds: LegalTextKind[] = ["terms", "privacy", "special_category"];
    expect(Object.keys(CONSENT_VERSIONS).sort()).toEqual([...kinds].sort());
    for (const kind of kinds) {
      const version = CONSENT_VERSIONS[kind] ?? "";
      const link = new URL(legalLinkPath(kind, version), "https://api.test");
      const res = await app.request(link.pathname);
      expect(res.status).toBe(302);
      expect(`${res.headers.get("location")}${link.hash}`).toBe(legalPageUrl(kind, version));
    }
  });

  test.for([
    ["a kind that is read on another page", "/legal/special_category"],
    ["a kind that is gone", "/legal/research"],
    ["the shelf", "/legal"],
    ["a page with a trailing slash", "/legal/terms/"],
    ["a page of the site that is no legal text", "/legal/bylaws"],
  ] as const)("%s is not a link of the app's, and goes nowhere", async ([, path], { ctx }) => {
    const app = await appWith(ctx);
    const res = await app.request(path);
    expect(res.status).toBe(404);
    expect(res.headers.get("location")).toBeNull();
  });

  test("only a read is answered", async ({ ctx }) => {
    const app = await appWith(ctx);
    const res = await app.request("/legal/terms", { method: "POST" });
    expect(res.status).toBe(404);
    expect(res.headers.get("location")).toBeNull();
  });
});
