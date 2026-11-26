import { createI18n, typedT } from "@kuutti/i18n";
import {
  type CardPhoto,
  GUILD_OPTIONS,
  type LikeAnchor,
  type PhotoId,
  PROFILE_FIELDS,
  PROMPT_KEYS,
  type SharedField,
} from "@kuutti/schema";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  anchorColumns,
  anchorOf,
  type CardParts,
  exportedAnchor,
  partOn,
  sameAnchor,
} from "./anchor.ts";

// The anchored like's three columns, its check against a card and its words in
// the export (#463, ADR-077). Through the database: anchored-likes.test.ts and
// chat/anchors.test.ts.

const SHARED_FIELDS: readonly SharedField[] = ["hobbies", "languages", "university", "guild"];

const anAnchor: fc.Arbitrary<LikeAnchor> = fc.oneof(
  fc.uuid().map((id) => ({ kind: "photo", photoId: id as PhotoId }) as const),
  fc.constantFrom(...PROMPT_KEYS).map((prompt) => ({ kind: "prompt", prompt }) as const),
  fc.constant({ kind: "bio" } as const),
  fc
    .record({
      field: fc.constantFrom(...SHARED_FIELDS),
      option: fc.string({ minLength: 1, maxLength: 80 }),
    })
    .map(({ field, option }) => ({ kind: "shared", field, option }) as const),
);

/** An anchor whose shared item is an option of its field's list, as a card's can be. */
const aListedAnchor: fc.Arbitrary<LikeAnchor> = fc.oneof(
  anAnchor.filter((anchor) => anchor.kind !== "shared"),
  fc
    .constantFrom(...SHARED_FIELDS)
    .chain((field) =>
      fc
        .constantFrom(...(PROFILE_FIELDS[field].options as readonly string[]))
        .map((option) => ({ kind: "shared", field, option }) as const),
    ),
);

const photo = (id: string): CardPhoto => ({
  id: id as PhotoId,
  blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
  width: 800,
  height: 1067,
  caption: null,
  description: null,
});

const FIRST = "6f1c2d4e-0000-4000-8000-000000000001";
const SECOND = "6f1c2d4e-0000-4000-8000-000000000002";

const PARTS: CardParts = {
  photos: [photo(FIRST), photo(SECOND)],
  prompts: ["sunday"],
  bio: true,
  shared: { hobbies: ["yoga"], languages: ["fi"], university: [], guild: [] },
};

const row = ([anchor_kind, anchor_ref, anchor_field]: ReturnType<typeof anchorColumns>) => ({
  anchor_kind,
  anchor_ref,
  anchor_field,
});

describe("the three columns", () => {
  it("hold any anchor and give it back as it was", () => {
    fc.assert(
      fc.property(anAnchor, (anchor) => {
        expect(anchorOf(row(anchorColumns(anchor)))).toEqual(anchor);
      }),
    );
  });

  it("are all null for none, and none is read back", () => {
    expect(anchorColumns(null)).toEqual([null, null, null]);
    expect(anchorOf(row([null, null, null]))).toBeNull();
  });

  it("keep a reference only where the kind has one, and a field only for a shared item", () => {
    fc.assert(
      fc.property(anAnchor, (anchor) => {
        const [kind, ref, field] = anchorColumns(anchor);
        expect(kind).toBe(anchor.kind);
        expect(ref === null).toBe(anchor.kind === "bio");
        expect(field === null).toBe(anchor.kind !== "shared");
      }),
    );
  });
});

describe("the same part", () => {
  it("is the same anchor, and none is the same as none", () => {
    fc.assert(fc.property(anAnchor, (anchor) => sameAnchor(anchor, { ...anchor })));
    expect(sameAnchor(null, null)).toBe(true);
  });

  it("is never another part, nor none", () => {
    fc.assert(
      fc.property(anAnchor, anAnchor, (a, b) => {
        fc.pre(JSON.stringify(a) !== JSON.stringify(b));
        expect(sameAnchor(a, b)).toBe(false);
        expect(sameAnchor(a, null)).toBe(false);
        expect(sameAnchor(null, b)).toBe(false);
      }),
    );
  });

  it("tells one field's option from the same option of another field", () => {
    expect(
      sameAnchor(
        { kind: "shared", field: "hobbies", option: "fi" },
        { kind: "shared", field: "languages", option: "fi" },
      ),
    ).toBe(false);
  });
});

describe("the part on a card", () => {
  it.each([
    [
      "a photo of the card",
      { kind: "photo", photoId: SECOND },
      { kind: "photo", photo: photo(SECOND) },
    ],
    [
      "an answered prompt",
      { kind: "prompt", prompt: "sunday" },
      { kind: "prompt", prompt: "sunday" },
    ],
    ["the bio", { kind: "bio" }, { kind: "bio" }],
    [
      "a shared item",
      { kind: "shared", field: "hobbies", option: "yoga" },
      { kind: "shared", field: "hobbies", option: "yoga" },
    ],
  ] as [string, LikeAnchor, unknown][])("%s is found", (_, anchor, part) => {
    expect(partOn(PARTS, anchor)).toEqual(part);
  });

  it.each([
    ["a photo not on the card", { kind: "photo", photoId: "6f1c2d4e-0000-4000-8000-000000000009" }],
    ["a prompt not answered", { kind: "prompt", prompt: "proud_of" }],
    ["an option not shared", { kind: "shared", field: "hobbies", option: "chess" }],
    ["a shared option of another field", { kind: "shared", field: "languages", option: "yoga" }],
  ] as [string, LikeAnchor][])("%s is no part", (_, anchor) => {
    expect(partOn(PARTS, anchor)).toBeNull();
  });

  it("is no bio on a card without one", () => {
    expect(partOn({ ...PARTS, bio: false }, { kind: "bio" })).toBeNull();
  });

  it("is nothing with no card or no anchor", () => {
    fc.assert(fc.property(anAnchor, (anchor) => partOn(null, anchor) === null));
    expect(partOn(PARTS, null)).toBeNull();
  });
});

describe("the part in the export's words", () => {
  const t = {
    en: typedT(createI18n({ locale: "en" }), "en"),
    fi: typedT(createI18n({ locale: "fi" }), "fi"),
    sv: typedT(createI18n({ locale: "sv" }), "sv"),
  };

  it.each([
    [
      "en",
      "Liked their photo",
      "Liked their answer to: My ideal Sunday",
      "Liked their bio",
      "Liked what you share: Yoga",
    ],
  ] as const)("in %s", (locale, ofPhoto, ofPrompt, ofBio, ofShared) => {
    const say = (anchor: LikeAnchor) => exportedAnchor(t[locale], anchor);
    expect(say({ kind: "photo", photoId: FIRST as PhotoId })).toEqual({
      kind: "photo",
      prompt: null,
      shared: null,
      inWords: ofPhoto,
    });
    expect(say({ kind: "prompt", prompt: "sunday" })).toEqual({
      kind: "prompt",
      prompt: "sunday",
      shared: null,
      inWords: ofPrompt,
    });
    expect(say({ kind: "bio" })).toEqual({
      kind: "bio",
      prompt: null,
      shared: null,
      inWords: ofBio,
    });
    expect(say({ kind: "shared", field: "hobbies", option: "yoga" })).toEqual({
      kind: "shared",
      prompt: null,
      shared: { field: "hobbies", option: "yoga" },
      inWords: ofShared,
    });
  });

  it("says every kind in each language, never a photo's id", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<"en" | "fi" | "sv">("en", "fi", "sv"),
        aListedAnchor,
        (locale, anchor) => {
          const said = exportedAnchor(t[locale], anchor);
          expect(said.kind).toBe(anchor.kind);
          expect(said.inWords.length).toBeGreaterThan(0);
          // Every placeholder filled, and no key left for want of a text.
          expect(said.inWords).not.toMatch(/[{}]|profile\.|account\./);
          if (anchor.kind === "photo") expect(JSON.stringify(said)).not.toContain(anchor.photoId);
        },
      ),
    );
  });

  it("names a listed guild by its own name in every language, and another guild as one", () => {
    const listed = GUILD_OPTIONS.find((option) => !option.endsWith("_other"));
    if (!listed) throw new Error("no listed guild");
    for (const say of Object.values(t)) {
      expect(
        exportedAnchor(say, { kind: "shared", field: "guild", option: listed }).inWords,
      ).toContain("Teologian Ylioppilaiden Tiedekuntayhdistys");
    }
    expect(
      exportedAnchor(t.en, { kind: "shared", field: "guild", option: "helsinki_other" }).inWords,
    ).toBe("Liked what you share: Another guild");
  });
});
