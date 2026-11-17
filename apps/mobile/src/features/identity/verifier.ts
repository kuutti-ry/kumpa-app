import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { getRandomValues } from "expo-crypto";

/**
 * What binds a bank login's one-time code to this phone (RFC 8252 §8.1,
 * ADR-027): every start makes a verifier, kept with the pending mark, and
 * /auth/start carries its SHA-256; /auth/exchange takes the code only with
 * the verifier. Another app that reads the code off the deep link has no
 * verifier to send. Both are 64 lowercase hex characters, the challenge as
 * the API hashes the verifier.
 */

/**
 * 32 bytes from the system's generator (SecRandomCopyBytes on iOS,
 * SecureRandom on Android), 256 random bits, as RFC 7636 §4.1 asks of a
 * verifier (ADR-027 §5). `getRandomValues` and not `getRandomBytes`, which
 * falls back to Math.random in a development build without a sync bridge.
 */
export const newVerifier = (): string => bytesToHex(getRandomValues(new Uint8Array(32)));

export const challengeOf = (verifier: string): string => bytesToHex(sha256(utf8ToBytes(verifier)));
