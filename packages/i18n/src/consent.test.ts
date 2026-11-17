import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CONSENT_TEXT_HASHES,
  CONSENT_TEXT_LOCALES,
  CONSENT_VERSIONS,
} from "./generated/consent.ts";
import {
  isLegalTextKind,
  LEGAL_PAGES,
  legalLinkPath,
  legalPageUrl,
  legalSitePage,
} from "./legal.ts";

/**
 * A wording and its version move together (#46, #208, ADR-010 §4): an edit
 * to a legal.* text that keeps the version would let every existing consent
 * silently cover the new wording, whether the edit is to the English, which
 * binds, or to the Finnish, which a Finnish phone shows. When this test
 * fails, either bump the consent_version of that kind and update the row
 * here, or revert the text.
 */
const GOLDEN: Record<string, { version: string; hash: string }> = {
  privacy: { version: "2026-11-1", hash: "884bedba27b248eb" },
  special_category: { version: "2026-11-1", hash: "2dec874099c7169d" },
  terms: { version: "2026-11-1", hash: "5d729e8dacab1f1e" },
};

describe("consent versions", () => {
  // The app says that the English counts above a legal text read in Finnish
  // and nowhere else (BeforeSignIn, OnboardingScreen): a Swedish phone reads
  // the English itself. A wording in a third language is a translation too,
  // and those screens have to say so of it before it lands here.
  it("names every kind the API requires, in English and Finnish and in no other language", () => {
    for (const kind of ["terms", "privacy", "special_category"]) {
      expect(CONSENT_VERSIONS[kind], kind).toBeTruthy();
      expect(CONSENT_TEXT_LOCALES[kind], kind).toEqual(["en", "fi"]);
    }
  });

  it("changes the version whenever a wording changes, in English or in Finnish", () => {
    for (const [kind, golden] of Object.entries(GOLDEN)) {
      expect({ version: CONSENT_VERSIONS[kind], hash: CONSENT_TEXT_HASHES[kind] }, kind).toEqual(
        golden,
      );
    }
  });

  // The site's anchors (kumpa-app-site, #208): the sensitive answers are read
  // on the privacy page.
  it("links each kind to the site's page at the anchor of the version this app carries", () => {
    expect(
      Object.fromEntries(
        Object.entries(CONSENT_VERSIONS).map(([kind, version]) => [
          kind,
          isLegalTextKind(kind) ? legalPageUrl(kind, version) : null,
        ]),
      ),
    ).toEqual({
      privacy: `https://kumpa.fi/legal/privacy/#privacy-${CONSENT_VERSIONS.privacy}`,
      special_category: `https://kumpa.fi/legal/privacy/#special_category-${CONSENT_VERSIONS.special_category}`,
      terms: `https://kumpa.fi/legal/terms/#terms-${CONSENT_VERSIONS.terms}`,
    });
    expect(isLegalTextKind("toString")).toBe(false);
  });

  // The phone opens the API's path (ADR-010 §4, amendment of 2026-11-17),
  // which sends it to the site's page; the anchor rides along.
  it("links the app to the API's page of each kind, at the anchor of the version", () => {
    expect(legalLinkPath("terms", "2026-11-1")).toBe("/legal/terms#terms-2026-11-1");
    expect(legalLinkPath("privacy", "2026-11-1")).toBe("/legal/privacy#privacy-2026-11-1");
    expect(legalLinkPath("special_category", "2026-11-1")).toBe(
      "/legal/privacy#special_category-2026-11-1",
    );
    expect(LEGAL_PAGES.map(legalSitePage)).toEqual([
      "https://kumpa.fi/legal/terms/",
      "https://kumpa.fi/legal/privacy/",
    ]);
  });

  // The website's CI reads CONSENT_VERSIONS out of this module on main
  // (appVersionsFrom in kumpa-app-site src/lib/consent.ts: this expression,
  // then JSON of what the braces hold without its last comma). A change of
  // the generator's shape fails here first; change the site's reader with it
  // and merge that first, or the site's CI goes red on its next run (#208).
  it("keeps CONSENT_VERSIONS in the shape the website's mirror check reads", () => {
    const source = readFileSync(new URL("./generated/consent.ts", import.meta.url), "utf8");
    const block = /export const CONSENT_VERSIONS\b[^=]*=\s*\{([^}]*)\};/.exec(source);
    expect(block).not.toBeNull();
    expect(JSON.parse(`{${(block?.[1] ?? "").trim().replace(/,$/, "")}}`)).toEqual(
      CONSENT_VERSIONS,
    );
  });
});
