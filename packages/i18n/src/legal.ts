/**
 * Where the full text of each legal wording is read (#208, ADR-010 §4): the
 * website (`kuutti-ry/kumpa-app-site`) holds it under the same version as
 * the app's summary, at an anchor named by the kind and the version. The
 * site's build publishes the address of each in /legal/versions.json, and
 * the app's CI holds this address to it (`pnpm check:legal-versions`), so a
 * link from the app never names a version the site does not have. A link to
 * the public site, not a web surface of the product (CLAUDE.md rule 8).
 *
 * The app does not link the site itself: it opens the API's `/legal/<page>`,
 * which sends the browser on to the site's page (ADR-010 §4, amendment of
 * 2026-11-17), so the site can move without a build of the app.
 */
export const LEGAL_SITE = "https://kumpa.fi";

/** The page each kind is read on: the sensitive answers are on the privacy page. */
const PAGE = {
  terms: "terms",
  privacy: "privacy",
  special_category: "privacy",
} as const;

export type LegalTextKind = keyof typeof PAGE;

/** The pages of the legal texts: the API answers for each (`/legal/terms`, `/legal/privacy`). */
export type LegalPage = (typeof PAGE)[LegalTextKind];
export const LEGAL_PAGES: readonly LegalPage[] = ["terms", "privacy"];

export const isLegalTextKind = (kind: string): kind is LegalTextKind => Object.hasOwn(PAGE, kind);

/** A legal page on the website: `https://kumpa.fi/legal/privacy/`. */
export function legalSitePage(page: LegalPage): string {
  return `${LEGAL_SITE}/legal/${page}/`;
}

/** The full text of a kind at the anchor of a version: `https://kumpa.fi/legal/privacy/#special_category-2026-11-1`. */
export function legalPageUrl(kind: LegalTextKind, version: string): string {
  return `${legalSitePage(PAGE[kind])}#${kind}-${version}`;
}

/**
 * The app's link to that text, through the API: `/legal/privacy#special_category-2026-11-1`.
 * The browser keeps the fragment across the API's redirect (RFC 9110 §10.2.2),
 * so it lands at the version's anchor.
 */
export function legalLinkPath(kind: LegalTextKind, version: string): string {
  return `/legal/${PAGE[kind]}#${kind}-${version}`;
}
