import { expect } from "vitest";
import { attack } from "./attack.ts";
import {
  fetchPublished,
  legalVersionProblems,
  type Published,
  siteFingerprint,
} from "./legal-versions.ts";

// Attacks on check:legal-versions (#380): the app's consent versions and the
// site's part in a way the comparison may not read, or the site's document is
// missing and that reads as agreement (.claude/rules/i18n.md, the bullet on
// one version per kind; the header of legal-versions.ts).

const APP = { special_category: "2026-10-draft-2", terms: "2026-09-draft-1" };
const FI = {
  "legal.special_category.title": "Arkaluonteiset tiedot",
  "legal.special_category.summary": "Arkaluonteiset vastaukset, kokonaan.",
};
const EN = {
  "legal.special_category.title": "Sensitive answers",
  "legal.special_category.summary": "The sensitive answers, in full.",
};
/** The app's texts by language: the site says which one its fingerprint is of. */
const TEXTS = { en: EN, fi: FI };
const SITE: Published = {
  terms: {
    version: "2026-09-draft-1",
    hash: "65b7fa7d00ed9290",
    language: "en",
    url: "https://kuutti.app/legal/terms/#terms-2026-09-draft-1",
  },
  special_category: {
    version: "2026-10-draft-2",
    hash: siteFingerprint(FI["legal.special_category.title"], FI["legal.special_category.summary"]),
    language: "fi",
    url: "https://kuutti.app/legal/privacy/#special_category-2026-10-draft-2",
  },
};
const sensitive = SITE.special_category as Published[string];
const terms = SITE.terms as Published[string];

const silent = (seen: string[]) => expect(seen).toEqual([]);
const agreed = () => legalVersionProblems(APP, SITE, TEXTS);

/** What is tried, and the two sides as they then stand. */
const PARTED: [string, () => string[]][] = [
  [
    "a kind the site names with a capital",
    () => legalVersionProblems(APP, { terms, Special_category: sensitive }, TEXTS),
  ],
  [
    "an address that differs from the app's link by one slash",
    () =>
      legalVersionProblems(
        APP,
        { ...SITE, terms: { ...terms, url: terms.url.replace("/#", "#") } },
        TEXTS,
      ),
  ],
  [
    "a sensitive-answers text the site calls Finnish of Finland, not Finnish",
    () =>
      legalVersionProblems(
        APP,
        { ...SITE, special_category: { ...sensitive, language: "fi-FI" } },
        TEXTS,
      ),
  ],
  [
    "a sensitive-answers text the site calls English, with the fingerprint of the app's Finnish",
    () =>
      legalVersionProblems(
        APP,
        { ...SITE, special_category: { ...sensitive, language: "en" } },
        TEXTS,
      ),
  ],
  [
    "a sensitive-answers text in a language the app has no legal text in, with the fingerprint of its Finnish",
    () =>
      legalVersionProblems(
        APP,
        { ...SITE, special_category: { ...sensitive, language: "sv" } },
        TEXTS,
      ),
  ],
  [
    "a sensitive-answers text in a language named as every object's own maker is",
    () =>
      legalVersionProblems(
        APP,
        { ...SITE, special_category: { ...sensitive, language: "constructor" } },
        TEXTS,
      ),
  ],
  [
    "a Finnish sensitive-answers title that changed only in its capitals",
    () =>
      legalVersionProblems(APP, SITE, {
        en: EN,
        fi: { ...FI, "legal.special_category.title": "TUTKIMUS" },
      }),
  ],
  [
    "a Finnish sensitive-answers wording the app no longer has",
    () => legalVersionProblems(APP, SITE, { en: EN, fi: {} }),
  ],
  ["an app with no legal text in any language", () => legalVersionProblems(APP, SITE, {})],
  [
    "a version the app carries with a space after it",
    () => legalVersionProblems({ ...APP, terms: `${APP.terms} ` }, SITE, TEXTS),
  ],
];

for (const [name, parted] of PARTED) {
  attack(`check:legal-versions: ${name} passes`, {
    attempt: parted,
    control: agreed,
    succeeds: silent,
  });
}

// "Nothing found, read as nothing wrong": neither side names a kind. The
// comparison goes kind by kind, and with no kind on either side asks nothing.
attack("check:legal-versions: an app and a site that both name no kind at all agree", {
  attempt: () => legalVersionProblems({}, {}, TEXTS),
  control: agreed,
  succeeds: silent,
});

/** How reading the site's document ended: the kinds it gave, or the refusal. */
const reading = async (answer: () => Response) => {
  try {
    return Object.keys(await fetchPublished(async () => answer(), "https://site.test/v.json"));
  } catch (error) {
    return `refused: ${(error as Error).message}`;
  }
};

/** What is tried, and the site's answer. */
const UNREADABLE: [string, () => Response][] = [
  ["an answer with no body at all", () => new Response(null, { status: 204 })],
  ["an answer that is JSON's null", () => new Response("null")],
  ["an answer that is a list of kinds", () => new Response(JSON.stringify([SITE.terms]))],
  [
    "a page that says the file has moved",
    () => new Response("<html>Moved</html>", { status: 301 }),
  ],
];

for (const [name, answer] of UNREADABLE) {
  attack(`check:legal-versions: ${name} is read as the site's document`, {
    attempt: () => reading(answer),
    control: () => reading(() => new Response(JSON.stringify(SITE))),
    succeeds: (seen) => expect(Array.isArray(seen)).toBe(true),
  });
}
