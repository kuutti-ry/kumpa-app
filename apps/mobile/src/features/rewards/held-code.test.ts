import { INVITATION_CODE_PATTERN } from "@kuutti/schema";
import fc from "fast-check";
import type * as HeldCode from "./held-code";

// A friend's code that came to the phone by itself (#184, ADR-044 §13,
// ADR-074 §4): from the one link, `/i/{code}`, or on Android from Play's
// install referrer, read once. Kept on the phone, one at a time, until it is
// used or the API says it is no use; only what reads as a code is kept.

const KEY = "kuutti.preference.invitationCode";
const READ = "kuutti.preference.referrerRead";
const CODE = "ABCDEFGHJK";
const OTHER = "ZYXWV98765";
const link = (rest: string) => `https://api.kumpa.fi/i/${rest}`;

type Started = typeof HeldCode & {
  store: Map<string, string>;
  reads: jest.Mock;
  referrer: jest.Mock;
};

/**
 * The module as a start of the app finds it: nothing remembered yet, over a
 * phone's store of its own, holding what an earlier run `kept`. Every module
 * is loaded afresh, React Native too, since the phone's kind is read from it
 * when it is asked for, not when the module loads.
 */
function start(os: "ios" | "android" = "ios", kept: Record<string, string> = {}): Started {
  jest.resetModules();
  const { Platform } = require("react-native") as typeof import("react-native");
  jest.replaceProperty(Platform, "OS", os);
  const secure = require("expo-secure-store") as {
    __store: Map<string, string>;
    getItemAsync: jest.Mock;
  };
  for (const [key, value] of Object.entries(kept)) secure.__store.set(key, value);
  const { getInstallReferrerAsync } = require("expo-application") as {
    getInstallReferrerAsync: jest.Mock;
  };
  return {
    ...(require("./held-code") as typeof HeldCode),
    store: secure.__store,
    reads: secure.getItemAsync,
    referrer: getInstallReferrerAsync,
  };
}

afterEach(() => jest.restoreAllMocks());

describe("a link from outside the app", () => {
  it.each([
    ["the scheme's return", "fi.kumpa://auth?code=abc"],
    ["the scheme with the link's path", `fi.kumpa://i/${CODE}`],
    ["the bank login's return", "https://api.kumpa.fi/auth/return?code=abc"],
    ["the store's link, which carries no code", "https://api.kumpa.fi/i"],
    ["the store's link with a query", "https://api.kumpa.fi/i?x=1"],
    ["a longer first segment", `https://api.kumpa.fi/invite/${CODE}`],
    ["the path further down", `https://api.kumpa.fi/x/i/${CODE}`],
    ["the path in a query", `https://api.kumpa.fi/?next=/i/${CODE}`],
    ["plain http", `http://api.kumpa.fi/i/${CODE}`],
    ["a path without a host", `/i/${CODE}`],
    ["no host at all", `https:///i/${CODE}`],
    ["an app's own path", "/chats/5"],
    ["nothing", ""],
  ])("passes %s on as it came, and keeps nothing", async (_what, from) => {
    const { takeInvitationLink, heldInvitationCode, store } = start();
    expect(takeInvitationLink(from)).toBe(from);
    expect(await heldInvitationCode()).toBeNull();
    expect(store.has(KEY)).toBe(false);
  });

  it.each([
    ["as it is shared", link("ABCDE-FGHJK"), CODE],
    ["ungrouped", link(CODE), CODE],
    ["in small letters", link("abcde-fghjk"), CODE],
    ["with a slash after it", link("ABCDE-FGHJK/"), CODE],
    ["with a query after it", link("ABCDE-FGHJK?utm_source=x&code=ZZZZZZZZZZ"), CODE],
    ["with a fragment after it", link("ABCDE-FGHJK#top"), CODE],
    ["with an encoded space", link("ABCDE%20FGHJK"), CODE],
    ["with an encoded letter", link("%41BCDE-FGHJK"), CODE],
    ["with O, I and L for 0 and 1", link("ABCDE-FGOIL"), "ABCDEFG011"],
    ["on the old name", `https://api.kuutti.app/i/${CODE}`, CODE],
    ["on staging", `https://api.staging.kumpa.fi/i/${CODE}`, CODE],
    ["on staging's old name", `https://api.staging.kuutti.app/i/${CODE}`, CODE],
    ["with the scheme and host in capitals", `HTTPS://API.KUMPA.FI/i/${CODE}`, CODE],
    ["with a port", `https://api.kumpa.fi:443/i/${CODE}`, CODE],
  ])("takes the code of a link %s and goes home", async (_what, from, code) => {
    const { takeInvitationLink, heldInvitationCode, store } = start();
    expect(takeInvitationLink(from)).toBe("/");
    expect(await heldInvitationCode()).toBe(code);
    expect(store.get(KEY)).toBe(code);
  });

  it.each([
    ["no code after the slash", link("")],
    ["nine characters", link("ABCDEFGHJ")],
    ["eleven characters", link("ABCDEFGHJKM")],
    ["a U, which no code has", link("ABCDE-FGHJU")],
    ["a code and more of a path", link("ABCDE-FGHJK/more")],
    ["two codes", link(`${CODE}/${OTHER}`)],
    ["an encoded slash", link("ABCDE%2FFGHJK")],
    ["a path that does not decode", link("ABCDE-FGHJ%E0%A4%A")],
    ["a line break in it", link("ABCDE-FGHJK%0A<script>")],
    ["only a query", link("?code=ABCDEFGHJK")],
  ])("goes home from a link with %s, with nothing kept", async (_what, from) => {
    const { takeInvitationLink, heldInvitationCode, store } = start();
    expect(takeInvitationLink(from)).toBe("/");
    expect(await heldInvitationCode()).toBeNull();
    expect(store.has(KEY)).toBe(false);
  });

  it("takes any code in any spelling the field takes, and of anything else keeps only what reads as a code", async () => {
    const code = fc.stringMatching(/^[0-9A-HJKMNP-TV-Z]{10}$/);
    const spelt = fc
      .tuple(code, fc.boolean(), fc.boolean(), fc.constantFrom("", "/", "?a=b", "#x"))
      .map(([plain, small, grouped, tail]) => {
        const shown = grouped ? `${plain.slice(0, 5)}-${plain.slice(5)}` : plain;
        return { plain, from: link(`${small ? shown.toLowerCase() : shown}${tail}`) };
      });
    const { takeInvitationLink, heldInvitationCode, dropHeldInvitationCode } = start();
    await fc.assert(
      fc.asyncProperty(spelt, async ({ plain, from }) => {
        await dropHeldInvitationCode();
        expect(takeInvitationLink(from)).toBe("/");
        expect(await heldInvitationCode()).toBe(plain);
      }),
      { seed: 184, numRuns: 300 },
    );
    const anything = fc.oneof(
      fc.string({ maxLength: 80 }),
      fc.string({ unit: "binary", maxLength: 40 }).map((rest) => link(rest)),
      fc.webUrl({ withQueryParameters: true, withFragments: true }),
    );
    await fc.assert(
      fc.asyncProperty(anything, async (from) => {
        await dropHeldInvitationCode();
        const to = takeInvitationLink(from);
        expect([from, "/"]).toContain(to);
        const held = await heldInvitationCode();
        if (held !== null) {
          expect(to).toBe("/");
          expect(held).toMatch(INVITATION_CODE_PATTERN);
        }
      }),
      { seed: 184, numRuns: 400 },
    );
  });

  it("keeps one code, the newest link's", async () => {
    const { takeInvitationLink, heldInvitationCode, store } = start("ios", { [KEY]: "0000000000" });
    takeInvitationLink(link(CODE));
    takeInvitationLink(link(OTHER));
    expect(await heldInvitationCode()).toBe(OTHER);
    expect(store.get(KEY)).toBe(OTHER);
    expect([...store.keys()]).toEqual([KEY]);
  });

  it("leaves the code it holds alone when a later link carries none", async () => {
    const { takeInvitationLink, heldInvitationCode, store } = start();
    takeInvitationLink(link(CODE));
    takeInvitationLink(link("nothing-here"));
    expect(await heldInvitationCode()).toBe(CODE);
    expect(store.get(KEY)).toBe(CODE);
  });
});

describe("the code to put in the field", () => {
  it("is the one an earlier run kept, read from the phone once", async () => {
    const { heldInvitationCode, reads } = start("ios", { [KEY]: CODE });
    expect(await heldInvitationCode()).toBe(CODE);
    expect(await heldInvitationCode()).toBe(CODE);
    expect(reads.mock.calls.filter(([key]) => key === KEY)).toHaveLength(1);
  });

  it.each([
    ["words", "words, not a code"],
    ["a code with a U", "ABCDEFGHJU"],
    ["a code too long", `${CODE}M`],
    ["nothing", ""],
  ])("is nothing when the phone kept %s", async (_what, kept) => {
    const { heldInvitationCode } = start("ios", { [KEY]: kept });
    expect(await heldInvitationCode()).toBeNull();
  });

  it("is a link's code, not the phone's older one, when the link came while the phone was read", async () => {
    const { takeInvitationLink, heldInvitationCode, store } = start("ios", { [KEY]: CODE });
    const asked = heldInvitationCode();
    takeInvitationLink(link(OTHER));
    expect(await asked).toBe(OTHER);
    expect(await heldInvitationCode()).toBe(OTHER);
    expect(store.get(KEY)).toBe(OTHER);
  });

  it("asks Play nothing on an iPhone", async () => {
    const { heldInvitationCode, referrer, store } = start("ios");
    expect(await heldInvitationCode()).toBeNull();
    expect(referrer).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it("is the code Play says the install came with, on Android, asked once", async () => {
    const { heldInvitationCode, referrer, store } = start("android");
    referrer.mockResolvedValue(CODE);
    expect(await heldInvitationCode()).toBe(CODE);
    expect(await heldInvitationCode()).toBe(CODE);
    expect(referrer).toHaveBeenCalledTimes(1);
    expect(store.get(KEY)).toBe(CODE);
    expect(store.get(READ)).toBe("1");
  });

  it.each([
    ["an install nobody referred", "utm_source=google-play&utm_medium=organic"],
    ["a campaign's words", `utm_source=friend&utm_content=${CODE}`],
    // What the one link hands Play for /i?from=<channel> (#653), even for a
    // channel whose name is ten of a code's letters.
    ["a channel's link", "utm_source=channel-7"],
    ["a channel's link named like a code", `utm_source=${CODE.toLowerCase()}`],
    ["nothing", ""],
  ])("keeps nothing of %s, and does not ask Play again", async (_what, said) => {
    const { heldInvitationCode, referrer, store } = start("android");
    referrer.mockResolvedValue(said);
    expect(await heldInvitationCode()).toBeNull();
    expect(await heldInvitationCode()).toBeNull();
    expect(referrer).toHaveBeenCalledTimes(1);
    expect(store.has(KEY)).toBe(false);
    expect(store.get(READ)).toBe("1");
  });

  it("does not ask Play at a later start, once it has answered", async () => {
    const { heldInvitationCode, referrer } = start("android", { [READ]: "1" });
    referrer.mockResolvedValue(CODE);
    expect(await heldInvitationCode()).toBeNull();
    expect(referrer).not.toHaveBeenCalled();
  });

  it("asks Play again when it did not answer", async () => {
    const { heldInvitationCode, referrer, store } = start("android");
    referrer.mockRejectedValueOnce(new Error("no Play on this phone"));
    referrer.mockResolvedValue(CODE);
    expect(await heldInvitationCode()).toBeNull();
    expect(store.size).toBe(0);
    expect(await heldInvitationCode()).toBe(CODE);
    expect(referrer).toHaveBeenCalledTimes(2);
    expect(store.get(READ)).toBe("1");
  });

  it("puts a link's code ahead of the install's, and the phone's own ahead of asking", async () => {
    const linked = start("android");
    linked.referrer.mockResolvedValue(CODE);
    linked.takeInvitationLink(link(OTHER));
    expect(await linked.heldInvitationCode()).toBe(OTHER);
    expect(linked.referrer).not.toHaveBeenCalled();

    const kept = start("android", { [KEY]: OTHER });
    kept.referrer.mockResolvedValue(CODE);
    expect(await kept.heldInvitationCode()).toBe(OTHER);
    expect(kept.referrer).not.toHaveBeenCalled();
  });

  it("keeps the link's code when it came while Play was asked", async () => {
    const { takeInvitationLink, heldInvitationCode, referrer, store } = start("android");
    let answer: (said: string) => void = () => undefined;
    referrer.mockReturnValue(new Promise<string>((resolve) => (answer = resolve)));
    const asked = heldInvitationCode();
    // The phone's two reads first, then Play is asked.
    for (let turn = 0; turn < 20 && referrer.mock.calls.length === 0; turn += 1) {
      await Promise.resolve();
    }
    expect(referrer).toHaveBeenCalledTimes(1);
    takeInvitationLink(link(OTHER));
    answer(CODE);
    expect(await asked).toBe(OTHER);
    expect(store.get(KEY)).toBe(OTHER);
    expect(store.get(READ)).toBe("1");
  });
});

describe("the held code goes", () => {
  it("after a code that worked, from the phone too", async () => {
    const { takeInvitationLink, heldInvitationCode, dropHeldInvitationCode, store } = start();
    takeInvitationLink(link(CODE));
    await dropHeldInvitationCode();
    expect(await heldInvitationCode()).toBeNull();
    expect(store.has(KEY)).toBe(false);
  });

  it("after a code that worked, when it was the phone's from an earlier run", async () => {
    const { heldInvitationCode, dropHeldInvitationCode, store } = start("ios", { [KEY]: CODE });
    await dropHeldInvitationCode();
    expect(await heldInvitationCode()).toBeNull();
    expect(store.has(KEY)).toBe(false);
  });

  it.each([
    ["as shown", "ABCDE-FGHJK"],
    ["in small letters with spaces", " abcde fghjk "],
    ["as kept", CODE],
  ])("after a refusal of that very code, typed %s", async (_what, typed) => {
    const { heldInvitationCode, dropHeldInvitationCode, store } = start("ios", { [KEY]: CODE });
    await dropHeldInvitationCode(typed);
    expect(await heldInvitationCode()).toBeNull();
    expect(store.has(KEY)).toBe(false);
  });

  it.each([
    ["another code", "ZYXWV-98765"],
    ["nothing", ""],
    ["half of it", "ABCDE"],
  ])("but stays after a refusal of %s", async (_what, typed) => {
    const { heldInvitationCode, dropHeldInvitationCode, store } = start("ios", { [KEY]: CODE });
    await dropHeldInvitationCode(typed);
    expect(await heldInvitationCode()).toBe(CODE);
    expect(store.get(KEY)).toBe(CODE);
  });

  it("and a refusal with none held changes nothing", async () => {
    const { heldInvitationCode, dropHeldInvitationCode, store } = start();
    await dropHeldInvitationCode("ABCDE-FGHJK");
    expect(await heldInvitationCode()).toBeNull();
    expect(store.size).toBe(0);
  });
});
