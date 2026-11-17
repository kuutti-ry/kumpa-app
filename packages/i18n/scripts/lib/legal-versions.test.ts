import { describe, expect, it, vi } from "vitest";
import {
  fetchPublished,
  legalVersionProblems,
  type Published,
  parsePublished,
  siteFingerprint,
  VERSIONS_URL,
} from "./legal-versions.ts";

// The app's half of #208: its CONSENT_VERSIONS against the site's
// /legal/versions.json. No network: every fetch here is a stand-in.

const APP = {
  privacy: "2026-09-draft-1",
  special_category: "2026-10-draft-2",
  terms: "2026-09-draft-1",
};

/**
 * The wordings the site carries as the app has them, by language (stand-ins).
 * The site says which of a consent's wordings counts: the English of the
 * sensitive answers, unless the site says another.
 */
const EN = {
  "legal.special_category.title": "Sensitive answers",
  "legal.special_category.summary": "The sensitive answers, in full.",
};
const FI = {
  "legal.special_category.title": "Arkaluonteiset tiedot",
  "legal.special_category.summary": "Arkaluonteiset vastaukset, kokonaan.",
};
const TEXTS = { en: EN, fi: FI };
const SENSITIVE_EN = siteFingerprint(
  EN["legal.special_category.title"],
  EN["legal.special_category.summary"],
);
const SENSITIVE_FI = siteFingerprint(
  FI["legal.special_category.title"],
  FI["legal.special_category.summary"],
);

/** The document as the site's build writes it, its own fields included. */
const SITE = {
  terms: {
    version: "2026-09-draft-1",
    hash: "65b7fa7d00ed9290",
    language: "en",
    url: "https://kumpa.fi/legal/terms/#terms-2026-09-draft-1",
    dated: "2026-10-01",
  },
  privacy: {
    version: "2026-09-draft-1",
    hash: "422ac16a1df3d859",
    language: "en",
    url: "https://kumpa.fi/legal/privacy/#privacy-2026-09-draft-1",
    dated: "2026-10-06",
  },
  special_category: {
    version: "2026-10-draft-2",
    hash: SENSITIVE_EN,
    language: "en",
    url: "https://kumpa.fi/legal/privacy/#special_category-2026-10-draft-2",
    dated: "2026-10-08",
  },
};
const published = (): Published => parsePublished(JSON.stringify(SITE));

describe("siteFingerprint", () => {
  it("is the site's: the same pair gives the value the site's test holds (scripts/consent.test.ts there)", () => {
    expect(siteFingerprint(" Tutkimus ", "LUONNOS: teksti.\r\n")).toBe("3db7397d9d6d2d5c");
    expect(siteFingerprint("Tutkimus", "LUONNOS: teksti.")).toBe("3db7397d9d6d2d5c");
    expect(siteFingerprint("Tutkimus", "LUONNOS: teksti!")).not.toBe("3db7397d9d6d2d5c");
    expect(siteFingerprint("Tutkimussuostumus", "LUONNOS: teksti.")).not.toBe("3db7397d9d6d2d5c");
  });
});

describe("parsePublished", () => {
  it("reads the version, the address and the fingerprint of each kind and leaves the day", () => {
    expect(published().special_category).toEqual({
      version: "2026-10-draft-2",
      hash: SENSITIVE_EN,
      language: "en",
      url: "https://kumpa.fi/legal/privacy/#special_category-2026-10-draft-2",
    });
  });

  const entry = (fields: Record<string, unknown>) =>
    JSON.stringify({
      terms: { version: "1", hash: "0123456789abcdef", language: "en", url: "u", ...fields },
    });
  it.each<[string, string, RegExp]>([
    ["not JSON", "<html>Not found</html>", /^is not JSON$/],
    ["an array", "[]", /is not a versions document: \(the document\): /],
    ["a kind without a version", entry({ version: undefined }), /terms\.version: /],
    ["an empty version", entry({ version: "" }), /terms\.version: /],
    ["a kind without an address", entry({ url: undefined }), /terms\.url: /],
    ["a kind without a fingerprint", entry({ hash: undefined }), /terms\.hash: /],
    ["a fingerprint that is not 16 hex digits", entry({ hash: "0123" }), /terms\.hash: /],
    ["a kind without the language of its text", entry({ language: "" }), /terms\.language: /],
    ["a kind that is not an object", '{"terms":"2026-09-draft-1"}', /terms: /],
  ])("refuses %s", (_, text, message) => {
    expect(() => parsePublished(text)).toThrow(message);
  });
});

describe("fetchPublished", () => {
  it("asks the deployed site for JSON, with a time limit, and reads the answer", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(SITE)));
    await expect(fetchPublished(fetchImpl)).resolves.toEqual(published());
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://kumpa.fi/legal/versions.json",
      expect.objectContaining({
        headers: { accept: "application/json" },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(VERSIONS_URL).toBe("https://kumpa.fi/legal/versions.json");
  });

  it("fails on a 404, so a site that has not published the file is never a pass", async () => {
    const fetchImpl = async () => new Response("Not found", { status: 404 });
    await expect(fetchPublished(fetchImpl, "https://site.test/v.json")).rejects.toThrow(
      "https://site.test/v.json answered 404",
    );
  });

  it("fails on an answer that is not the document, naming the address", async () => {
    const fetchImpl = async () => new Response("<html></html>", { status: 200 });
    await expect(fetchPublished(fetchImpl, "https://site.test/v.json")).rejects.toThrow(
      "https://site.test/v.json is not JSON",
    );
  });

  // A stand-in for the pause between tries: no clock, the pauses recorded.
  const paused = () => {
    const pauses: number[] = [];
    return { pauses, pause: async (ms: number) => void pauses.push(ms) };
  };
  const answers = (...steps: (number | Error)[]) =>
    vi.fn(async () => {
      const step = steps.shift();
      if (step === undefined) throw new Error("asked once too often");
      if (step instanceof Error) throw step;
      return new Response(step === 200 ? JSON.stringify(SITE) : "Busy", { status: step });
    });

  it("tries again after a network failure and a 5xx, the pauses growing, and reads the third answer", async () => {
    const { pauses, pause } = paused();
    const fetchImpl = answers(new TypeError("fetch failed"), 503, 200);
    await expect(fetchPublished(fetchImpl, VERSIONS_URL, pause)).resolves.toEqual(published());
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(pauses).toEqual([5_000, 10_000]);
  });

  it("passes on the third network failure as it came", async () => {
    const { pauses, pause } = paused();
    const failed = new TypeError("fetch failed");
    const fetchImpl = answers(failed, failed, failed);
    await expect(fetchPublished(fetchImpl, VERSIONS_URL, pause)).rejects.toThrow("fetch failed");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(pauses).toEqual([5_000, 10_000]);
  });

  it("fails on the third 5xx with its status", async () => {
    const { pause } = paused();
    const fetchImpl = answers(502, 502, 502);
    await expect(fetchPublished(fetchImpl, "https://site.test/v.json", pause)).rejects.toThrow(
      "https://site.test/v.json answered 502",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("pauses on the clock by default, five seconds after the first failure", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = answers(new TypeError("fetch failed"), 200);
      const reading = fetchPublished(fetchImpl);
      await vi.advanceTimersByTimeAsync(4_999);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(reading).resolves.toEqual(published());
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not try a 4xx again", async () => {
    const { pauses, pause } = paused();
    const fetchImpl = answers(404);
    await expect(fetchPublished(fetchImpl, VERSIONS_URL, pause)).rejects.toThrow("answered 404");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(pauses).toEqual([]);
  });
});

describe("legalVersionProblems", () => {
  it("finds nothing when every kind has the site's version, address and counted wording", () => {
    expect(legalVersionProblems(APP, published(), TEXTS)).toEqual([]);
  });

  it("fails when the site published a new version the app does not carry yet", () => {
    const site = published();
    site.privacy = {
      ...SITE.privacy,
      version: "2026-11-1",
      url: "https://kumpa.fi/legal/privacy/#privacy-2026-11-1",
    };
    expect(legalVersionProblems(APP, site, TEXTS)).toEqual([
      expect.stringMatching(
        /^privacy: the app carries 2026-09-draft-1, the site publishes 2026-11-1 \(https:\/\/kumpa\.fi\/legal\/privacy\/#privacy-2026-11-1\)\. The site's text leads/,
      ),
    ]);
  });

  it("fails when the app moved a version the site has not published", () => {
    expect(legalVersionProblems({ ...APP, terms: "2026-11-1" }, published(), TEXTS)).toEqual([
      expect.stringMatching(
        /^terms: the app carries 2026-11-1, the site publishes 2026-09-draft-1/,
      ),
    ]);
  });

  it("fails on a kind either side lacks", () => {
    const { special_category: _, ...withoutSensitive } = SITE;
    expect(
      legalVersionProblems(APP, parsePublished(JSON.stringify(withoutSensitive)), TEXTS),
    ).toEqual([
      "special_category: the site publishes no version of it (the app carries 2026-10-draft-2)",
    ]);
    const { special_category: __, ...appWithout } = APP;
    expect(legalVersionProblems(appWithout, published(), TEXTS)).toEqual([
      "special_category: the site publishes a version of a kind the app does not know",
    ]);
  });

  it("fails when the app's link is not the address the site publishes for the version", () => {
    const site = published();
    site.terms = {
      ...SITE.terms,
      version: "2026-09-draft-1",
      url: "https://kumpa.fi/fi/legal/terms/#terms-2026-09-draft-1",
    };
    expect(legalVersionProblems(APP, site, TEXTS)).toEqual([
      "terms: the app links to https://kumpa.fi/legal/terms/#terms-2026-09-draft-1, the site publishes the text at https://kumpa.fi/fi/legal/terms/#terms-2026-09-draft-1",
    ]);
  });

  it("fails on a kind both carry that the app has no page for", () => {
    const police = { ...SITE.terms, version: "1", url: "https://kumpa.fi/x" };
    const site = { ...published(), police };
    expect(legalVersionProblems({ ...APP, police: "1" }, site, TEXTS)).toEqual([
      "police: the app has no page for it to link to (src/legal.ts)",
    ]);
  });

  it("fails when the site's text of a consent is not this app's wording in the language the site names, under the same version", () => {
    // The site bumped the version with its old text, or edited its text in
    // place, or the app's wording moved: either way two texts, one version.
    const site = published();
    site.special_category = { ...SITE.special_category, hash: "72a206b59f5659c5" };
    expect(legalVersionProblems(APP, site, TEXTS)).toEqual([
      `special_category: the site's text of 2026-10-draft-2 (en, 72a206b59f5659c5) is not this app's legal.special_category.title and summary in that language (${SENSITIVE_EN}). The site carries this wording as the app has it, so one of the two changed without the other: one version, one text`,
    ]);
    // The English is the one the site holds here.
    const retitled = { ...EN, "legal.special_category.title": "Special answers" };
    expect(legalVersionProblems(APP, published(), { en: retitled, fi: FI })).toEqual([
      expect.stringMatching(
        new RegExp(
          `^special_category: the site's text of 2026-10-draft-2 \\(en, ${SENSITIVE_EN}\\) is not this app's legal\\.special_category\\.title and summary in that language`,
        ),
      ),
    ]);
    const reworded = { ...EN, "legal.special_category.summary": "The sensitive answers." };
    expect(legalVersionProblems(APP, published(), { en: reworded, fi: FI })).toHaveLength(1);
  });

  it("holds the wording the site says counts and no other: the translation beside it is the golden row's", () => {
    // The Finnish of the sensitive answers is not in the site's document
    // (src/consent.test.ts ties it to its version in this repository).
    const moved = {
      en: EN,
      fi: { ...FI, "legal.special_category.summary": "Jotain muuta." },
    };
    expect(legalVersionProblems(APP, published(), moved)).toEqual([]);
  });

  it("follows the language the site names for a consent, whichever of the app's it is", () => {
    const finnish = published();
    finnish.special_category = { ...SITE.special_category, language: "fi", hash: SENSITIVE_FI };
    expect(legalVersionProblems(APP, finnish, TEXTS)).toEqual([]);
    // The language changed and the fingerprint did not: the English text, called Finnish.
    const renamed = published();
    renamed.special_category = { ...SITE.special_category, language: "fi" };
    expect(legalVersionProblems(APP, renamed, TEXTS)).toEqual([
      `special_category: the site's text of 2026-10-draft-2 (fi, ${SENSITIVE_EN}) is not this app's legal.special_category.title and summary in that language (${SENSITIVE_FI}). The site carries this wording as the app has it, so one of the two changed without the other: one version, one text`,
    ]);
  });

  it.each<[string, string, Record<string, Record<string, string>>]>([
    ["a language the app has no catalogue of", "sv", TEXTS],
    ["a language whose catalogue was not handed over", "en", { fi: FI }],
    [
      "a catalogue without the title",
      "en",
      { en: { "legal.special_category.summary": EN["legal.special_category.summary"] }, fi: FI },
    ],
    [
      "a catalogue without the summary",
      "en",
      { en: { "legal.special_category.title": EN["legal.special_category.title"] }, fi: FI },
    ],
    ["a name every object answers to", "constructor", TEXTS],
  ])(
    "fails when the site's consent is in %s, never passing on a text it cannot read",
    (_, language, texts) => {
      const site = published();
      site.special_category = { ...SITE.special_category, language };
      expect(legalVersionProblems(APP, site, texts)).toEqual([
        `special_category: the site's text of 2026-10-draft-2 is in "${language}" (${SENSITIVE_EN}), and this app has no legal.special_category.title and summary in that language. The site carries this wording as the app has it: one version, one text`,
      ]);
    },
  );

  it("holds no fingerprint of the terms or the privacy policy: the site's full text, the app's summary", () => {
    const full = published();
    full.terms = { ...SITE.terms, hash: "0123456789abcdef", language: "fi" };
    full.privacy = { ...SITE.privacy, hash: "fedcba9876543210", language: "sv" };
    expect(legalVersionProblems(APP, full, TEXTS)).toEqual([]);
  });

  it("reports a wrong link and a parted wording of one kind together", () => {
    const site = published();
    site.special_category = {
      ...SITE.special_category,
      hash: "72a206b59f5659c5",
      url: "https://kumpa.fi/legal/special_category/",
    };
    expect(legalVersionProblems(APP, site, TEXTS)).toEqual([
      expect.stringMatching(/^special_category: the app links to /),
      expect.stringMatching(/^special_category: the site's text of /),
    ]);
  });
});
