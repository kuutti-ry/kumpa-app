import { INVITATION_CODE_PATTERN, normaliseInvitationCode } from "@kuutti/schema";
import { getInstallReferrerAsync } from "expo-application";
import { Platform } from "react-native";
import { readPreference, writePreference } from "@/lib/preferences";

/**
 * A friend's code that came to this phone by itself (#184, ADR-044 §13,
 * ADR-074 §4): in the one link, `/i/{code}`, which the system hands to the
 * app once it is installed, or, on Android, as Play's install referrer, read
 * once. It is kept on the phone, across the bank login and onboarding, and
 * put in the code's field (RedeemInvitation.tsx). Nothing is redeemed by
 * itself and nothing is sent before the person presses Use the code: a link
 * is somebody else's words, and a tap on one is no decision.
 *
 * One code at a time, the newest link's. It goes when it is used, and when
 * the API says it is no use, so a dead code is not offered twice. Only what
 * reads as a code is ever kept, and no code is logged or reported.
 */

/** This run's code, ahead of its write; undefined until the store has been read. */
let held: string | null | undefined;

const codeIn = (raw: string): string | null => {
  const code = normaliseInvitationCode(raw);
  return INVITATION_CODE_PATTERN.test(code) ? code : null;
};

async function hold(code: string): Promise<void> {
  held = code;
  await writePreference("invitationCode", code);
}

/**
 * `https://<host>/i/{code}`, as the system hands it over; `/i` alone is the
 * store's and never comes here. The host is not looked at: the system hands
 * over only the hosts app.json names, and an app that addresses this one
 * directly can name any host it likes, so what a link may do is what is
 * bounded: it fills a field.
 */
const LINK = /^https:\/\/[^/?#]+\/i\/([^?#]*?)\/?(?:[?#].*)?$/is;

/**
 * A link from outside the app, on its way to the router (app/+native-intent.ts).
 * An invitation's link leaves its code here and goes home, where a person who
 * has not signed in yet meets the bank login; any other link passes as it
 * came. One whose path is no code goes home too, with nothing kept.
 */
export function takeInvitationLink(link: string): string {
  if (!LINK.test(link)) return link;
  let rest = "";
  try {
    rest = decodeURIComponent(link.replace(LINK, "$1"));
  } catch {
    // A path that does not decode is no code.
  }
  const code = codeIn(rest);
  if (code !== null) void hold(code);
  return "/";
}

/**
 * The code to put in the field, or null. With none from a link, an Android
 * phone asks Play once what the install came with (ADR-044 §13: the referrer
 * is the code alone); an answer is asked for again only after a failure, and
 * anything that is no code, an organic install's words included, is dropped.
 */
export async function heldInvitationCode(): Promise<string | null> {
  if (held === undefined) {
    const stored = codeIn((await readPreference("invitationCode")) ?? "");
    // A link taken while the store was read is newer than what it held.
    if (held === undefined) held = stored;
  }
  if (
    held === null &&
    Platform.OS === "android" &&
    (await readPreference("referrerRead")) === null
  ) {
    let referrer: string;
    try {
      referrer = await getInstallReferrerAsync();
    } catch {
      // No Play on this phone, or it did not answer: asked again next time.
      return held;
    }
    await writePreference("referrerRead", "1");
    const code = codeIn(referrer);
    if (code !== null && held === null) await hold(code);
  }
  return held;
}

/**
 * The held code goes: always after a code that worked, since a person takes
 * one invitation, and after a refusal only when it was the held code that was
 * refused (`only`, as typed).
 */
export async function dropHeldInvitationCode(only?: string): Promise<void> {
  if (only !== undefined && normaliseInvitationCode(only) !== (await heldInvitationCode())) return;
  held = null;
  await writePreference("invitationCode", null);
}
