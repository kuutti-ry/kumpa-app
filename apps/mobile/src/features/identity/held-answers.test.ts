import * as SecureStore from "expo-secure-store";
import fc from "fast-check";
import { Platform } from "react-native";
import {
  answeredAll,
  bindHeldAnswers,
  dropHeldAnswers,
  dropUnboundConsent,
  HELD_ANSWERS_FOR_MS,
  type HeldAnswers,
  holdAnswers,
  readHeldAnswers,
  releaseConsent,
  takeHeldAnswers,
} from "./held-answers";

const { __store: store } = jest.requireMock("expo-secure-store") as {
  __store: Map<string, string>;
};
const KEY = "kuutti.heldAnswers";
const NOW = Date.parse("2026-11-19T10:00:00.000Z");
const CONSENT = { version: "2026-10-1", locale: "fi" } as const;
/** All four answers as the keychain keeps them: the consent is never there. */
const STORED: Omit<HeldAnswers, "at"> = {
  name: "Aino",
  gender: "woman",
  seeks: ["man"],
  postalCode: "00530",
};
const ALL: Omit<HeldAnswers, "at"> = { ...STORED, specialCategory: CONSENT };
const A = "a".repeat(64);
const B = "b".repeat(64);
const stored = () => {
  const raw = store.get(KEY);
  return raw === undefined ? undefined : (JSON.parse(raw) as Record<string, unknown>);
};
const keep = (value: unknown) => store.set(KEY, JSON.stringify(value));

beforeEach(async () => {
  // The consent lives in the module: each test starts with none.
  await dropHeldAnswers();
  store.delete(KEY);
  jest.clearAllMocks();
});
afterEach(() => jest.restoreAllMocks());

describe("held answers (#681, ADR-010 §22)", () => {
  it("keeps each answer in this phone's keychain only, with the time of the last", async () => {
    await holdAnswers({ name: "Aino" }, NOW);
    await holdAnswers({ gender: "woman" }, NOW + 1000);
    expect(stored()).toEqual({ name: "Aino", gender: "woman", at: NOW + 1000 });
    // Readable while the phone is unlocked, never in a backup or on another phone.
    for (const call of (SecureStore.setItemAsync as jest.Mock).mock.calls) {
      expect(call[0]).toBe(KEY);
      expect(call[2]).toEqual({ keychainAccessible: "WHEN_UNLOCKED_THIS_DEVICE_ONLY" });
    }
    expect(await readHeldAnswers(NOW + 2000)).toEqual({
      name: "Aino",
      gender: "woman",
      at: NOW + 1000,
    });
  });

  it("removes an answer set to nothing, and leaves the others", async () => {
    keep({ ...STORED, gender: "non_binary", identityLabel: "agender", at: NOW });
    const next = await holdAnswers({ identityLabel: undefined }, NOW + 1);
    expect(next).not.toHaveProperty("identityLabel");
    expect(stored()).toEqual({ ...STORED, gender: "non_binary", at: NOW + 1 });
  });

  it("Held answers go an hour after the last answer", async () => {
    keep({ ...ALL, at: NOW });
    // Each answer moves the hour on.
    await holdAnswers({ name: "Aino K" }, NOW + HELD_ANSWERS_FOR_MS - 1);
    expect(await readHeldAnswers(NOW + 2 * HELD_ANSWERS_FOR_MS - 1)).toMatchObject({
      name: "Aino K",
    });
    // An hour and a millisecond after the last, they are removed as they are read.
    expect(await readHeldAnswers(NOW + 2 * HELD_ANSWERS_FOR_MS)).toBeNull();
    expect(store.has(KEY)).toBe(false);
  });

  it("keeps them at an hour exactly, and removes answers from the future, a clock turned back", async () => {
    keep({ ...ALL, at: NOW });
    expect(await readHeldAnswers(NOW + HELD_ANSWERS_FOR_MS)).not.toBeNull();
    keep({ ...ALL, at: NOW + 1 });
    expect(await readHeldAnswers(NOW)).toBeNull();
    expect(store.has(KEY)).toBe(false);
  });

  it("holds the first answer from now when the earlier ones are an hour old", async () => {
    keep({ ...ALL, at: NOW });
    const next = await holdAnswers({ name: "Sam" }, NOW + HELD_ANSWERS_FOR_MS + 1);
    expect(next).toEqual({ name: "Sam", at: NOW + HELD_ANSWERS_FOR_MS + 1 });
  });

  it.each([
    ["nothing at all", undefined],
    ["text that is not JSON", "{"],
    ["a number", "7"],
    ["null", "null"],
    ["a list", "[]"],
    ["an object with no time", JSON.stringify(ALL)],
    ["a time that is text", JSON.stringify({ ...ALL, at: String(NOW) })],
    ["a time that is no number", '{"at": 1e999}'],
  ])("reads %s as no answers", async (_, raw) => {
    if (raw !== undefined) store.set(KEY, raw);
    expect(await readHeldAnswers(NOW)).toBeNull();
    // What cannot be read is removed.
    expect(store.has(KEY)).toBe(false);
  });

  it("leaves out each answer that does not read, and keeps the rest", async () => {
    keep({
      at: NOW,
      name: "x".repeat(41),
      gender: "robot",
      identityLabel: "nope",
      seeks: ["man", "man"],
      specialCategory: { version: "v1", locale: "de" },
      postalCode: "123",
      attempt: 42,
    });
    expect(await readHeldAnswers(NOW)).toEqual({ at: NOW });
    // Whom one seeks is a hard filter: one value no longer known leaves it all
    // out, to be asked again, rather than narrowing it.
    keep({ at: NOW, name: "Aino", seeks: ["man", "robot", "woman"], attempt: "a".repeat(129) });
    expect(await readHeldAnswers(NOW)).toEqual({ at: NOW, name: "Aino" });
    keep({ at: NOW, seeks: [] });
    expect(await readHeldAnswers(NOW)).toEqual({ at: NOW });
    keep({ at: NOW, seeks: ["man", "woman", "non_binary", "man"] });
    expect(await readHeldAnswers(NOW)).toEqual({ at: NOW });
    // A consent in the store is no consent given in this run.
    keep({ ...ALL, at: NOW });
    expect(await readHeldAnswers(NOW)).toEqual({ ...STORED, at: NOW });
  });

  it("reads every answer the app writes", async () => {
    const all = {
      ...STORED,
      gender: "non_binary",
      identityLabel: "genderqueer",
      seeks: ["woman", "man", "non_binary"],
      at: NOW,
      attempt: "f".repeat(64),
    };
    keep(all);
    expect(await readHeldAnswers(NOW)).toEqual(all);
  });

  it("reads anything the keychain may hold as answers the app could write, or as none, and never as a consent", async () => {
    const KEYS = ["at", "name", "gender", "identityLabel", "seeks", "postalCode", "attempt"];
    // Any value in each place, often one the app writes, so the reads that keep something are many.
    const answer = fc.oneof(
      fc.jsonValue(),
      fc.constantFrom<unknown>(
        "Aino",
        "woman",
        "non_binary",
        "genderqueer",
        ["man"],
        ["woman", "man"],
        "00530",
        A,
        CONSENT,
      ),
    );
    const shaped = fc.record(
      {
        at: fc.oneof(fc.constant(NOW), fc.jsonValue()),
        name: answer,
        gender: answer,
        identityLabel: answer,
        seeks: answer,
        specialCategory: answer,
        postalCode: answer,
        attempt: answer,
      },
      { requiredKeys: [] },
    );
    // With keys of no answer beside them, which no read keeps.
    const withOthers = fc
      .tuple(shaped, fc.dictionary(fc.string({ maxLength: 12 }), fc.jsonValue(), { maxKeys: 3 }))
      .map(([answers, others]) => ({ ...others, ...answers }));
    await fc.assert(
      fc.asyncProperty(fc.oneof(fc.jsonValue(), shaped, withOthers), async (value) => {
        keep(value);
        const read = await readHeldAnswers(NOW);
        if (read === null) {
          // What does not read is removed as it is read.
          expect(store.has(KEY)).toBe(false);
          return;
        }
        expect(Object.keys(read).filter((key) => !KEYS.includes(key))).toEqual([]);
        // Written back, it reads the same: nothing the parser keeps is one it would refuse.
        keep(read);
        expect(await readHeldAnswers(NOW)).toEqual(read);
      }),
      { seed: 681, numRuns: 300 },
    );
  });

  it("asks the questions again when the keychain cannot be read", async () => {
    (SecureStore.getItemAsync as jest.Mock).mockRejectedValueOnce(new Error("locked"));
    expect(await readHeldAnswers(NOW)).toBeNull();
  });

  it("holds an answer for this run when the keychain refuses it, and keeps nothing older a bank attempt could take", async () => {
    (SecureStore.setItemAsync as jest.Mock).mockRejectedValueOnce(new Error("full"));
    await expect(holdAnswers({ name: "Aino" }, NOW)).resolves.toEqual({ name: "Aino", at: NOW });
    expect(store.has(KEY)).toBe(false);
    // The screen shows men; the store would still say women, with the consent.
    await holdAnswers({ ...STORED, seeks: ["woman"], specialCategory: CONSENT }, NOW);
    (SecureStore.setItemAsync as jest.Mock).mockRejectedValueOnce(new Error("full"));
    await expect(holdAnswers({ seeks: ["man"] }, NOW + 1)).resolves.toMatchObject({
      seeks: ["man"],
    });
    expect(store.has(KEY)).toBe(false);
    expect(await bindHeldAnswers(A, NOW + 2)).toBe(false);
    expect(await readHeldAnswers(NOW + 2)).toBeNull();
  });

  it("goes with one bank attempt, and only that attempt's exchange takes them", async () => {
    await holdAnswers(ALL, NOW);
    expect(await bindHeldAnswers(A, NOW)).toBe(true);
    expect(stored()).toEqual({ ...STORED, attempt: A, at: NOW });
    // Another attempt's exchange gets nothing, and the answers go all the same.
    expect(await takeHeldAnswers(B, NOW)).toBeNull();
    expect(store.has(KEY)).toBe(false);
    expect(await readHeldAnswers(NOW)).toBeNull();

    await holdAnswers(ALL, NOW);
    await bindHeldAnswers(A, NOW);
    expect(await takeHeldAnswers(A, NOW)).toEqual({ ...ALL, at: NOW, attempt: A });
    expect(store.has(KEY)).toBe(false);
    // Taken once: the consent went with them.
    keep({ ...STORED, at: NOW, attempt: A });
    expect(await takeHeldAnswers(A, NOW)).toEqual({ ...STORED, at: NOW, attempt: A });
  });

  it("gives an exchange nothing of answers never bound to an attempt, or an hour old", async () => {
    keep({ ...STORED, at: NOW });
    expect(await takeHeldAnswers(A, NOW)).toBeNull();
    keep({ ...STORED, at: NOW, attempt: A });
    expect(await takeHeldAnswers(A, NOW + HELD_ANSWERS_FOR_MS + 1)).toBeNull();
    expect(store.has(KEY)).toBe(false);
  });

  it("binds nothing when there is nothing held, or the keychain refuses", async () => {
    expect(await bindHeldAnswers(A, NOW)).toBe(false);
    keep({ ...STORED, at: NOW });
    (SecureStore.setItemAsync as jest.Mock).mockRejectedValueOnce(new Error("full"));
    expect(await bindHeldAnswers(A, NOW)).toBe(false);
    expect(stored()).not.toHaveProperty("attempt");
  });

  describe("The consent for sensitive answers is the person's at the phone", () => {
    it("is held in memory for this run, never in the keychain", async () => {
      const next = await holdAnswers({ seeks: ["man"], specialCategory: CONSENT }, NOW);
      expect(next).toEqual({ seeks: ["man"], specialCategory: CONSENT, at: NOW });
      expect(stored()).toEqual({ seeks: ["man"], at: NOW });
      expect(await readHeldAnswers(NOW)).toEqual(next);
    });

    it("goes when the app leaves the screen, unless a bank attempt carries it", async () => {
      await holdAnswers(ALL, NOW);
      expect(dropUnboundConsent()).toBe(true);
      expect(await readHeldAnswers(NOW)).toEqual({ ...STORED, at: NOW });
      expect(dropUnboundConsent()).toBe(false);

      await holdAnswers({ specialCategory: CONSENT }, NOW);
      await bindHeldAnswers(A, NOW);
      expect(dropUnboundConsent()).toBe(false);
      expect(await takeHeldAnswers(A, NOW)).toMatchObject({ specialCategory: CONSENT });
    });

    it("goes with the next try after a link back from the bank, and is asked again once another attempt carried it", async () => {
      await holdAnswers(ALL, NOW);
      await bindHeldAnswers(A, NOW);
      releaseConsent();
      await bindHeldAnswers(B, NOW);
      expect(await takeHeldAnswers(B, NOW)).toEqual({ ...ALL, at: NOW, attempt: B });

      // Back in the app with no link: the next attempt binds the answers alone.
      await holdAnswers(ALL, NOW);
      await bindHeldAnswers(A, NOW);
      expect(await bindHeldAnswers(B, NOW)).toBe(true);
      expect(await takeHeldAnswers(B, NOW)).toEqual({ ...STORED, at: NOW, attempt: B });
      // Freed with none held is nothing.
      releaseConsent();
      expect(await readHeldAnswers(NOW)).toBeNull();
    });

    it("goes to the exchange of the attempt that carried it, never of one bound before it was given", async () => {
      // Answers bound to an attempt of an earlier run, the bank's tab left open;
      // somebody at the phone now gives the consent, and that old attempt's
      // link comes back before they open the bank.
      await holdAnswers(STORED, NOW);
      await bindHeldAnswers(A, NOW);
      await holdAnswers({ specialCategory: CONSENT }, NOW);
      expect(await takeHeldAnswers(A, NOW)).toEqual({ ...STORED, at: NOW, attempt: A });

      // Freed by a link back that was no session, it goes with no exchange of that attempt.
      await holdAnswers(ALL, NOW);
      await bindHeldAnswers(A, NOW);
      releaseConsent();
      expect(await takeHeldAnswers(A, NOW)).toEqual({ ...STORED, at: NOW, attempt: A });
    });

    it("goes when the switch is turned off, at a removal, and when the answers are gone", async () => {
      await holdAnswers(ALL, NOW);
      await holdAnswers({ specialCategory: undefined }, NOW);
      expect(await readHeldAnswers(NOW)).toEqual({ ...STORED, at: NOW });

      await holdAnswers({ specialCategory: CONSENT }, NOW);
      await dropHeldAnswers();
      keep({ ...STORED, at: NOW });
      expect(await readHeldAnswers(NOW)).toEqual({ ...STORED, at: NOW });

      // An hour old: the answers go as they are read, the consent with them.
      await holdAnswers({ specialCategory: CONSENT }, NOW);
      expect(await readHeldAnswers(NOW + HELD_ANSWERS_FOR_MS + 1)).toBeNull();
      keep({ ...STORED, at: NOW });
      expect(await readHeldAnswers(NOW)).toEqual({ ...STORED, at: NOW });

      // Removed from the store under it (the bank's screen at a refusal that lasts).
      await holdAnswers({ specialCategory: CONSENT }, NOW);
      store.delete(KEY);
      expect(await readHeldAnswers(NOW)).toBeNull();
      keep({ ...STORED, at: NOW });
      expect(await readHeldAnswers(NOW)).toEqual({ ...STORED, at: NOW });
    });
  });

  it("is gone once dropped, and a keychain that refuses the removal is no error", async () => {
    keep({ ...STORED, at: NOW });
    await dropHeldAnswers();
    expect(store.has(KEY)).toBe(false);
    (SecureStore.deleteItemAsync as jest.Mock).mockRejectedValueOnce(new Error("locked"));
    await expect(dropHeldAnswers()).resolves.toBeUndefined();
  });

  it("keeps them in memory alone on the web target", async () => {
    const os = jest.replaceProperty(Platform, "OS", "web");
    try {
      await holdAnswers({ name: "Aino" }, NOW);
      expect(await readHeldAnswers(NOW)).toEqual({ name: "Aino", at: NOW });
      expect(await bindHeldAnswers("a".repeat(64), NOW)).toBe(true);
      expect(await takeHeldAnswers("a".repeat(64), NOW)).toMatchObject({ name: "Aino" });
      expect(await readHeldAnswers(NOW)).toBeNull();
      expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
      expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
      expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
    } finally {
      await dropHeldAnswers();
      os.restore();
    }
  });

  describe("whether all four are answered", () => {
    it("is so with a name, a gender, whom one seeks with its consent, and a home", () => {
      expect(answeredAll({ ...ALL, at: NOW })).toBe(true);
    });

    it.each([
      ["nothing held", null],
      ["no name", { ...ALL, name: undefined, at: NOW }],
      ["a name of spaces", { ...ALL, name: "   ", at: NOW }],
      ["no gender", { ...ALL, gender: undefined, at: NOW }],
      ["nobody sought", { ...ALL, seeks: undefined, at: NOW }],
      ["no consent for the sensitive answer", { ...ALL, specialCategory: undefined, at: NOW }],
      ["no home", { ...ALL, postalCode: undefined, at: NOW }],
    ])("is not so with %s", (_, answers) => {
      expect(answeredAll(answers as HeldAnswers | null)).toBe(false);
    });
  });
});
