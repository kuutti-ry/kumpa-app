import { signInReturnPath } from "@/features/identity";
import { holdLinkWhileUnsaved } from "@/features/profile";
import { takeInvitationLink } from "@/features/rewards";

/**
 * Every link from outside the app passes here first (Expo Router). The two
 * https links the system hands to the app (app.json, ADR-074) become the
 * app's own paths: the bank login's return is the sign-in's screen, and an
 * invitation's link leaves its code and goes home. While a screen holds
 * something unsaved, the link waits for the person's word (ConfirmLeave.tsx,
 * #285); otherwise it goes through.
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  return holdLinkWhileUnsaved(takeInvitationLink(signInReturnPath(path)), initial);
}
