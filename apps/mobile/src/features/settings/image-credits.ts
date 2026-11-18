/**
 * The images the app carries whose terms ask for credit (#405), one row per
 * set on the licences screen: its author, where it was found, and its licence
 * with the licence's address, as CC BY-SA 4.0 §3(a) asks; the set's
 * `NOTICE.md` under `assets/` names every file's own page. A public-domain or
 * CC0 file asks for none, and a mark is shown only to name its owner, so
 * neither is here. `image-credits.test.ts` holds this list to those files.
 */
export const IMAGE_CREDITS = [
  {
    title: "tech.licenses.zodiac",
    author: "Kwamikagami",
    source: "Wikimedia Commons",
    licence: "CC BY-SA 4.0",
    licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
  },
] as const;
