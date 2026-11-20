import type { HomeSummary } from "@kuutti/schema";
import { saveChanges, saveGender, saveHome, savePreferences } from "@/features/profile";
import type { HeldAnswers } from "../held-answers";
import { fetchOnboarding, giveConsent } from "./client";

/** The home saved from the phone, for onboarding to show once what the card says of it. */
let savedHome: HomeSummary | null = null;

/** The home the last save from the phone set, once: onboarding's step of what the card shows. */
export function takeSavedHome(): HomeSummary | null {
  const home = savedHome;
  savedHome = null;
  return home;
}

/** A save that may fail: what did not land, onboarding asks again. */
async function tried<T>(save: () => Promise<T>): Promise<T | null> {
  try {
    return await save();
  } catch {
    return null;
  }
}

/**
 * Right after the exchange (#681, ADR-010 §22): the answers held on the phone
 * saved through the routes that exist, as the acceptances are (`POST
 * /consents`), so the sign-in itself does not change. Only what the account
 * lacks is filled: somebody with an account who answered the questions anyway
 * keeps the account's answers, since a gender changes once in 30 days (#147)
 * and a change of whom one seeks moves likes and cards (#542). The consent for
 * sensitive answers goes before whom one seeks, which the API refuses without
 * it (ADR-010 §16). Nothing is saved before the terms and the privacy notice
 * in force are the account's (ADR-010 §22): an acceptance that did not land
 * leaves every answer to onboarding, after its welcome step. Each save stands
 * alone, and one that fails is left to onboarding, which asks what is still
 * missing. Never throws: the sign-in is done whatever this finds. Every
 * exchange comes through here, with nothing held too, so a home saved for the
 * last person on the phone is never shown to the next.
 */
export async function saveHeldAnswers(held: HeldAnswers | null): Promise<void> {
  savedHome = null;
  if (held === null) return;
  const status = await tried(fetchOnboarding);
  if (status === null) return;
  const { consents, currentVersions } = status;
  if (consents.terms !== currentVersions.terms || consents.privacy !== currentVersions.privacy) {
    return;
  }
  const missing = new Set(status.missing);
  const freshGender = status.gender === null && held.gender !== undefined;
  const name = missing.has("name") && held.name?.trim() ? held.name.trim() : undefined;
  // The label goes with the gender it was offered after (ADR-019 §1).
  const label = freshGender && held.gender === "non_binary" ? held.identityLabel : undefined;
  if (name !== undefined || label !== undefined) {
    await tried(() =>
      saveChanges({
        ...(name !== undefined ? { displayName: name } : {}),
        ...(label !== undefined ? { fields: { identityLabel: label } } : {}),
      }),
    );
  }
  if (freshGender && held.gender) {
    const gender = held.gender;
    await tried(() => saveGender(gender));
  }
  if (status.preferences.seeks === null && held.seeks && held.specialCategory) {
    const { seeks, specialCategory } = held;
    const consented =
      status.consents.specialCategory !== null ||
      (await tried(() =>
        giveConsent("special_category", specialCategory.version, specialCategory.locale),
      )) !== null;
    if (consented) await tried(() => savePreferences({ seeks }));
  }
  if (status.home === null && held.postalCode) {
    const postalCode = held.postalCode;
    savedHome = await tried(() => saveHome({ postalCode }));
  }
}
