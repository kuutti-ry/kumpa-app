# Phase 8: the moderation panel and the packages

Two defects of the panel that the audit raised are fixed, both by #670 (`6ca05a33`, on `main`). The panel's pages, its hooks and its confirm steps stand as they were, and nothing moved out of `packages/schema`. The panel's and the packages' other defects are in `00-bugs.md` (B1, B2, B5, B11, B16, B17).

- **One person's page under another's title.** A report's page and a person's page are made anew for each id, so an answer for the page the moderator has left can no longer land on the page they went to (`ReportPage.tsx`, `AccountPage.tsx`). A person's page also lets only its latest read speak after an action.
- **"Show photo" on a person's page.** Each of those buttons is described by its photo's own line again, so a screen reader no longer hears several buttons that sound the same (`AccountPage.tsx`).
