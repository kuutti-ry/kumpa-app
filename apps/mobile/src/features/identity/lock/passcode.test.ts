import { createHash } from "node:crypto";
import { getRandomValues } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { hashPasscode, PASSCODE_LENGTH, passcodeMatches } from "./passcode";
import { writeLock } from "./store";

// The lock's passcode as the phone keeps it (#418, ADR-045 §3): a salted
// SHA-256 with sixteen fresh bytes of the system's generator for the salt,
// never the digits, and a comparison that answers only whether the typed code
// is the one set.

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const HEX_32 = /^[0-9a-f]{32}$/;
const HEX_64 = /^[0-9a-f]{64}$/;
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const random = jest.mocked(getRandomValues);
/** The generator as jest.setup.js stands it in: Node's own. */
const system = random.getMockImplementation();

/**
 * Salts counted up from a seed, so they are known and differ; every half of
 * a byte is one of a to f, so no run of digits in a salt can pass for a code.
 */
function countedSalts(seed = 0) {
  let n = seed;
  random.mockImplementation((array) => {
    n += 1;
    const letters = n.toString(6).padStart(array.byteLength * 2, "0");
    new Uint8Array(array.buffer).set(
      Array.from(
        { length: array.byteLength },
        (_, i) => (10 + Number(letters[i * 2])) * 16 + 10 + Number(letters[i * 2 + 1]),
      ),
    );
    return array;
  });
}

/** Every 7919th code of the million, the first and the last: a deterministic spread. */
const SPREAD = [
  "000000",
  ...Array.from({ length: 126 }, (_, i) => String(i * 7919).padStart(PASSCODE_LENGTH, "0")),
  "999999",
];

beforeEach(() => {
  store.clear();
  random.mockReset();
  if (system) random.mockImplementation(system);
});

describe("hashPasscode", () => {
  it("salts with sixteen bytes of the system's generator, asked once, as lowercase hex", () => {
    random.mockImplementationOnce((array) => {
      new Uint8Array(array.buffer).set(Array.from({ length: 16 }, (_, i) => (i * 53 + 7) % 256));
      return array;
    });
    const stored = hashPasscode("123456");
    expect(random).toHaveBeenCalledTimes(1);
    const [asked] = random.mock.calls[0] ?? [];
    expect(asked).toBeInstanceOf(Uint8Array);
    expect(asked).toHaveLength(16);
    expect(stored.salt).toBe("073c71a6db10457aafe4194e83b8ed22");
  });

  it("is the SHA-256 of the salt and the code, as lowercase hex", () => {
    const stored = hashPasscode("123456");
    expect(stored.salt).toMatch(HEX_32);
    expect(stored.hash).toMatch(HEX_64);
    expect(stored.hash).toBe(sha256(`${stored.salt}:123456`));
  });

  it("keeps the salt and the hash, nothing else", () => {
    expect(Object.keys(hashPasscode("123456")).sort()).toEqual(["hash", "salt"]);
  });

  it("gives the same code a new salt and a new hash every time", () => {
    const hashes = Array.from({ length: 50 }, () => hashPasscode("123456"));
    expect(new Set(hashes.map((h) => h.salt)).size).toBe(50);
    expect(new Set(hashes.map((h) => h.hash)).size).toBe(50);
  });
});

describe("the passcode at rest", () => {
  it("The passcode is stored only as a salted hash", async () => {
    countedSalts();
    const first = hashPasscode("123456");
    const second = hashPasscode("123456");
    // Salted: the same six digits set twice are two different hashes.
    expect(first.salt).not.toBe(second.salt);
    expect(first.hash).not.toBe(second.hash);
    expect(passcodeMatches("123456", first)).toBe(true);
    expect(passcodeMatches("123456", second)).toBe(true);

    await writeLock({ biometrics: false, passcode: first, graceMinutes: 1 });
    const kept = store.get("kuutti.lock") ?? "";
    expect(JSON.parse(kept)).toEqual({ biometrics: false, passcode: first, graceMinutes: 1 });
    expect(kept).not.toContain("123456");
    // Nothing else of the lock was written beside it.
    expect([...store.keys()]).toEqual(["kuutti.lock"]);
  });

  it("never holds the digits in what it keeps, across a spread of codes", () => {
    countedSalts(1000);
    for (const code of SPREAD) {
      const stored = hashPasscode(code);
      expect(JSON.stringify(stored)).not.toContain(code);
      expect(stored.hash).toBe(sha256(`${stored.salt}:${code}`));
    }
  });
});

describe("passcodeMatches", () => {
  it("knows the code that was set, for a spread of codes", () => {
    countedSalts(2000);
    for (const code of SPREAD) {
      expect(passcodeMatches(code, hashPasscode(code))).toBe(true);
    }
  });

  it("refuses every neighbouring code, a digit up or down in each place", () => {
    countedSalts(3000);
    for (const code of ["000000", "123456", "999999", "509871"]) {
      const stored = hashPasscode(code);
      for (let place = 0; place < PASSCODE_LENGTH; place += 1) {
        for (const step of [1, 9]) {
          const digit = (Number(code[place]) + step) % 10;
          const near = `${code.slice(0, place)}${digit}${code.slice(place + 1)}`;
          expect(passcodeMatches(near, stored)).toBe(false);
        }
      }
    }
  });

  it.each([
    ["one digit short", "12345"],
    ["one digit over", "1234567"],
    ["empty", ""],
    ["the code with a space", "123456 "],
    ["the digits in another script", "١٢٣٤٥٦"],
    ["the salt and the code as they are hashed", "x:123456"],
  ])("refuses %s", (_, typed) => {
    expect(passcodeMatches(typed, hashPasscode("123456"))).toBe(false);
  });

  it("refuses the right code under another salt", () => {
    const stored = hashPasscode("123456");
    expect(passcodeMatches("123456", { ...stored, salt: `${stored.salt.slice(1)}0` })).toBe(false);
  });

  it.each([
    ["is empty", () => ""],
    ["is cut short by a character", (hash: string) => hash.slice(0, -1)],
    ["has a character more", (hash: string) => `${hash}0`],
    ["is twice as long", (hash: string) => hash + hash],
  ])("refuses a stored hash that %s", (_, change) => {
    const stored = hashPasscode("123456");
    expect(passcodeMatches("123456", { ...stored, hash: change(stored.hash) })).toBe(false);
  });

  it.each([
    ["first", 0],
    ["middle", 32],
    ["last", 63],
  ])("refuses a stored hash that differs only in its %s character", (_, at) => {
    const stored = hashPasscode("123456");
    const other = stored.hash[at] === "0" ? "1" : "0";
    const hash = `${stored.hash.slice(0, at)}${other}${stored.hash.slice(at + 1)}`;
    expect(passcodeMatches("123456", { ...stored, hash })).toBe(false);
  });

  it("refuses a stored hash in uppercase, which this app never writes", () => {
    const stored = hashPasscode("123456");
    expect(passcodeMatches("123456", { ...stored, hash: stored.hash.toUpperCase() })).toBe(false);
  });
});
