# Phase 0: defects the audit found, fixed

All sixteen are fixed by #671 (`d8ca1e71`, on `main` since 13/11/2026), each with a test that failed before its fix. The numbers are the audit's.

## Tools that could reach the wrong database or process

- **B1, the seed.** It recognises both spellings of the environment flag and every production flag, and asks the server what it is before it writes anything, a tunnel included. A managed database is refused, except a pull request's preview named on purpose (`packages/db/src/cli/seed.ts`).
- **B2, the moderator command.** A flag no longer overrides `APP_ENV=production`, and taking a role away and ending its sessions is one transaction (`packages/db/src/cli/moderator.ts`). It stays a tool for production (ADR-006 §5).
- **B7, `pnpm env:up` and `env:down`.** A process is ours only inside this checkout's own path, read from its working directory and its parents'. `up` never stops a database to take its port: it refuses and names who holds it. `down` stops this checkout's compose stack and leaves anything else on the port running, a shared Homebrew PostgreSQL included (`scripts/dev-env.ts`).

## The API

- **B6, photos waiting for their check.** The night's retry goes through every waiting photo once a run and leaves out the ones it has tried, so a batch that keeps failing cannot hold back the photos behind it (`apps/api/src/media/moderation.ts`).
- **B15, the bank callback's log line.** An unexpected error is logged by its type, never by its message, which could quote personal data (`apps/api/src/identity/login.ts`).
- **B19, the photo cap.** A profile photo's insert is serialised per account before the count is taken, so two uploads at once cannot both pass it (`apps/api/src/media/repo.ts`).
- **The thumbnail.** It is cropped from the card image the automatic check saw, so it cannot show a part of the picture that was never checked (`apps/api/src/media/pipeline.ts`). Thumbnails stored before the fix were not made again.

## The phone app

- **B8, a conversation with no messages.** A refresh that fails keeps a conversation that was ready, an empty one too. A first load that fails still shows its error (`ConversationScreen.tsx`).
- **B9, a send that fails.** The message goes back into the field only when nothing newer has been typed there.
- **B12, a photo cached under another photo's key.** The URL and its photo and size are kept together, and an answer that is no longer the latest is ignored, after the picture has left the screen too (`PhotoImage.tsx`).
- **B13, uploads.** An upload gives up after two minutes, so a stalled one ends and can be tried again (`media/client.ts`).
- **B14, a contact typed in Settings.** A changed contact counts as unsaved until the API has confirmed it, and Settings' question on leaving covers it (`YourContacts.tsx`).

## The moderation panel

- **B5, approving a photo nobody saw.** Approve waits for the picture itself to have loaded, a sensitive photo's included, and stays off when the picture fails to load (`PhotoQueue.tsx`).
- **B11, signing in when the network fails.** An exchange that fails returns the panel to signed out, with the words to try again (`features/identity/session.tsx`).

## The translation tools

- **B16, numbers taken for phone numbers.** A number grouped with commas in English and with spaces in a translation compares as the same number; a phone number's digits added or changed are still refused (`packages/i18n/scripts/lib/translate.ts`).
- **B17, text inside a condition.** The check for text written straight into a screen looks inside `? :`, `&&` and bracketed branches (`packages/i18n/scripts/lib/ui-strings.ts`).
