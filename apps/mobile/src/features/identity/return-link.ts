/**
 * The bank login's return on its verified https link (#184, ADR-074 §2):
 * `/auth/return` on one of the API's hosts, which the system hands to this
 * app alone (app.json's links, the API's two files). It is the scheme's
 * `fi.kumpa://auth` under another address: the same screen takes it, with the
 * same guards, so a link somebody else wrote is refused as it always was
 * (SignInScreen.tsx). Any host is read: the system chooses which links come
 * here, and what a link carries is trusted for nothing by where it came from.
 * No URL parser, since React Native's is partial.
 */
const RETURN = /^https:\/\/[^/?#]+\/auth\/return(\?[^#]*)?(?:#|$)/i;

/** The app's own path for a return link, or the link as it came when it is no return. */
export function signInReturnPath(link: string): string {
  const match = RETURN.exec(link);
  return match ? `/auth${match[1] ?? ""}` : link;
}
