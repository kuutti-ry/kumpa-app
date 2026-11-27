import { createHash } from "node:crypto";
import { getRandomValues } from "expo-crypto";
import { challengeOf, newVerifier } from "./verifier";

// What binds the bank login's one-time code to this phone (ADR-027): a fresh
// verifier for every attempt, 32 bytes of the system's generator (§5), and
// the SHA-256 that /auth/start carries, in the hex the API hashes it to.

const HEX_64 = /^[0-9a-f]{64}$/;
const random = jest.mocked(getRandomValues);

beforeEach(() => random.mockClear());

describe("the sign-in attempt's verifier", () => {
  it("is 64 lowercase hex characters, 32 bytes asked of the system's generator once", () => {
    expect(newVerifier()).toMatch(HEX_64);
    expect(random).toHaveBeenCalledTimes(1);
    const [asked] = random.mock.calls[0] ?? [];
    expect(asked).toBeInstanceOf(Uint8Array);
    expect(asked).toHaveLength(32);
  });

  it("is the generator's bytes in their order, each as two lowercase hex characters", () => {
    random.mockImplementationOnce((array) => {
      new Uint8Array(array.buffer).set(Array.from({ length: 32 }, (_, i) => (i * 37 + 10) % 256));
      return array;
    });
    expect(newVerifier()).toBe("0a2f54799ec3e80d32577ca1c6eb10355a7fa4c9ee13385d82a7ccf1163b6085");
  });

  it("is a new one for every attempt", () => {
    const verifiers = Array.from({ length: 100 }, () => newVerifier());
    expect(new Set(verifiers).size).toBe(100);
    expect(random).toHaveBeenCalledTimes(100);
  });
});

describe("its challenge", () => {
  it("is the SHA-256 of the verifier as lowercase hex, as the API hashes it", () => {
    const verifier = newVerifier();
    const challenge = challengeOf(verifier);
    expect(challenge).toMatch(HEX_64);
    expect(challenge).toBe(createHash("sha256").update(verifier, "utf8").digest("hex"));
    expect(challenge).not.toBe(verifier);
  });

  it("is the standard's SHA-256 (FIPS 180-2's test vector)", () => {
    expect(challengeOf("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("differs between two verifiers", () => {
    expect(challengeOf("5a1e".repeat(16))).not.toBe(challengeOf("5a1f".repeat(16)));
  });
});
