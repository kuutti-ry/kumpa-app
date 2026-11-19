import {
  DISPLAY_NAME_MAX,
  GENDERS,
  Gender,
  PostalCode,
  PROFILE_FIELDS,
  type ProfileFields,
} from "@kuutti/schema";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * The answers given before there is an account (#681, ADR-010 §22): the name,
 * the gender with its label, whom one seeks with the consent for sensitive
 * answers, and the home's postal code. They stay on this phone until the bank
 * login saves them, and nothing of them leaves it before: no route, no log
 * line, no Sentry report. Kept as the lock is, in this phone's keychain or
 * keystore only, readable while it is unlocked, never in a backup or on
 * another phone, since whom one seeks is a sensitive answer (the maintainer,
 * 18/11/2026, reversing ADR-010 §13's choice of 10/10/2026). They go at the
 * save, at a refusal that lasts and on starting over; an hour after the last
 * answer they can no longer be read, and the next read removes them (the
 * maintainer, 19/11/2026). The web target keeps them in memory.
 *
 * The consent for sensitive answers is no answer to keep for whoever picks the
 * phone up next: it is held in memory for this run, as the acceptances are
 * (ADR-010 §15), and goes when the app leaves the screen unless it is carried
 * into a bank attempt; a link back from the bank frees it for the next try,
 * and one carried into another attempt is asked again. Whom one seeks is saved
 * only with it, so the person at the phone gives it (GDPR art. 9).
 */
export type HeldAnswers = {
  name?: string;
  gender?: Gender;
  /** Offered after a non-binary gender only (ADR-019 §1). */
  identityLabel?: ProfileFields["identityLabel"];
  seeks?: Gender[];
  /** The consent for sensitive answers given on the seeks screen in this run (memory only): the version read, in which language. */
  specialCategory?: SpecialCategory;
  postalCode?: string;
  /** When the last answer was given, in milliseconds. */
  at: number;
  /**
   * The bank attempt the answers go with, its challenge (ADR-027): set when
   * the bank is opened from the questions, so that answers left by somebody
   * who never signed in land in nobody else's account on a shared phone, as
   * the acceptances are bound (ADR-010 §15).
   */
  attempt?: string;
};

type SpecialCategory = { version: string; locale: "fi" | "sv" | "en" };

/** An hour after the last answer they are removed (the maintainer, 19/11/2026). */
export const HELD_ANSWERS_FOR_MS = 60 * 60 * 1000;

const KEY = "kuutti.heldAnswers";
const THIS_DEVICE = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

/** The web target's store: memory only, gone with the page. */
let onWeb: string | null = null;

/** The consent, never stored, and the attempt it is carried into. */
let consent: { given: SpecialCategory; attempt: string | null } | null = null;

async function readRaw(): Promise<string | null> {
  if (Platform.OS === "web") return onWeb;
  return SecureStore.getItemAsync(KEY, THIS_DEVICE);
}

/** What the store keeps of the answers: everything but the consent. */
async function writeAnswers(answers: HeldAnswers | null): Promise<void> {
  if (answers === null) return writeRaw(null);
  const { specialCategory: _consent, ...kept } = answers;
  return writeRaw(JSON.stringify(kept));
}

async function writeRaw(value: string | null): Promise<void> {
  if (Platform.OS === "web") {
    onWeb = value;
  } else if (value === null) {
    await SecureStore.deleteItemAsync(KEY, THIS_DEVICE);
  } else {
    await SecureStore.setItemAsync(KEY, value, THIS_DEVICE);
  }
}

const text = (value: unknown, max: number): string | undefined =>
  typeof value === "string" && value.length <= max ? value : undefined;

/**
 * What is stored, in the shape this app writes, each answer on its own: one
 * that does not read is left out, and is asked again. Whom one seeks is a hard
 * filter: a value this app no longer knows leaves the whole answer out rather
 * than narrowing it. Null for anything that is not an object with a time.
 */
function parse(raw: string): HeldAnswers | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const stored = value as Record<string, unknown>;
  if (typeof stored.at !== "number" || !Number.isFinite(stored.at)) return null;
  const answers: HeldAnswers = { at: stored.at };
  const name = text(stored.name, DISPLAY_NAME_MAX);
  if (name !== undefined) answers.name = name;
  const gender = Gender.safeParse(stored.gender);
  if (gender.success) answers.gender = gender.data;
  const label = PROFILE_FIELDS.identityLabel.schema.safeParse(stored.identityLabel);
  if (label.success && label.data !== undefined) answers.identityLabel = label.data;
  const seeks: unknown[] = Array.isArray(stored.seeks) ? stored.seeks : [];
  if (
    seeks.length > 0 &&
    seeks.length <= GENDERS.length &&
    new Set(seeks).size === seeks.length &&
    seeks.every((one) => Gender.safeParse(one).success)
  ) {
    answers.seeks = seeks as Gender[];
  }
  const postalCode = PostalCode.safeParse(stored.postalCode);
  if (postalCode.success) answers.postalCode = postalCode.data;
  const attempt = text(stored.attempt, 128);
  if (attempt) answers.attempt = attempt;
  return answers;
}

/**
 * The answers held, with the consent given in this run, or null when there
 * are none, they are an hour old, or the store cannot be read: each of those
 * asks the questions again. Old ones are removed here, the consent with them.
 */
export async function readHeldAnswers(now = Date.now()): Promise<HeldAnswers | null> {
  let raw: string | null;
  try {
    raw = await readRaw();
  } catch {
    return null;
  }
  if (raw === null) {
    consent = null;
    return null;
  }
  const answers = parse(raw);
  if (answers === null || now - answers.at > HELD_ANSWERS_FOR_MS || answers.at > now) {
    await dropHeldAnswers();
    return null;
  }
  return consent === null ? answers : { ...answers, specialCategory: consent.given };
}

/**
 * The answers with `patch` put on them, kept from now; an answer set to
 * undefined is removed, the consent too. The consent goes to memory alone, and
 * a new one is carried into no attempt yet.
 */
export async function holdAnswers(
  patch: Partial<Omit<HeldAnswers, "at" | "attempt">>,
  now = Date.now(),
): Promise<HeldAnswers> {
  const held = (await readHeldAnswers(now)) ?? { at: now };
  if ("specialCategory" in patch) {
    consent = patch.specialCategory ? { given: patch.specialCategory, attempt: null } : null;
  }
  const next: HeldAnswers = { ...held, ...patch, at: now };
  for (const key of Object.keys(next) as (keyof HeldAnswers)[]) {
    if (next[key] === undefined) delete next[key];
  }
  try {
    await writeAnswers(next);
  } catch {
    // Not kept: what the store still holds is older than what the screen
    // shows, and could be what a bank attempt binds. Nothing is held then;
    // the screen goes on from what it shows, and onboarding asks the rest.
    await dropHeldAnswers();
  }
  return next;
}

/**
 * Binds the answers to the bank attempt about to open, and the consent with
 * them unless another attempt carries it already; false when there are none.
 */
export async function bindHeldAnswers(attempt: string, now = Date.now()): Promise<boolean> {
  const held = await readHeldAnswers(now);
  if (held === null) return false;
  if (consent !== null) {
    consent =
      consent.attempt === null || consent.attempt === attempt ? { ...consent, attempt } : null;
  }
  try {
    await writeAnswers({ ...held, attempt });
  } catch {
    return false;
  }
  return true;
}

/** A link back from the bank that is not a session: the consent may go with the next try. */
export function releaseConsent(): void {
  if (consent !== null) consent = { ...consent, attempt: null };
}

/** The app leaves the screen: a consent carried into no attempt goes. True when one went. */
export function dropUnboundConsent(): boolean {
  if (consent === null || consent.attempt !== null) return false;
  consent = null;
  return true;
}

/**
 * Right after the exchange: the answers bound to this attempt, for the save,
 * or null. They are removed either way, since the phone now has an account
 * signed in, and answers bound to another attempt are nobody's of it.
 */
export async function takeHeldAnswers(
  attempt: string,
  now = Date.now(),
): Promise<HeldAnswers | null> {
  const held = await readHeldAnswers(now);
  const given = consent?.attempt === attempt ? consent.given : undefined;
  await dropHeldAnswers();
  if (held?.attempt !== attempt) return null;
  const { specialCategory: _consent, ...answers } = held;
  return given === undefined ? answers : { ...answers, specialCategory: given };
}

/** Removes the answers and the consent: a refusal that lasts, starting over, or the save. */
export async function dropHeldAnswers(): Promise<void> {
  consent = null;
  try {
    await writeRaw(null);
  } catch {
    // Unreadable is as good as gone: a read that fails asks the questions again.
  }
}

/** Whether all four questions are answered, so the terms come next. */
export const answeredAll = (held: HeldAnswers | null): boolean =>
  held !== null &&
  held.name !== undefined &&
  held.name.trim().length > 0 &&
  held.gender !== undefined &&
  held.seeks !== undefined &&
  held.specialCategory !== undefined &&
  held.postalCode !== undefined;
