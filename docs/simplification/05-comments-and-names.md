# Phase 5: comments and names

What was done is narrow. No sweep of the comments was made: they stand as they were, in their length, their history and their citations, and so does the rule for them in `CLAUDE.md`. Of the audit's sixty renames one was made.

## Comments that were wrong (#678)

Comments only: each changed file compiles to the same code with its comments stripped.

- **Five stood over the wrong thing**, each a comment that had slid above a neighbour's when something was added between it and what it describes (a constant, a type, a card). They were moved, words unchanged: `recordConsent`'s (`apps/api/src/identity/repo.ts`), `ShortPool`'s (`apps/api/src/matching/rounds.ts`), `AccountDeletionRequest`'s and `AccountExport`'s (`packages/schema/src/account.ts`), and the break's notice on the sign-in screen.
- **Eight spoke of work to come that had landed**: the erasure "applied to what exists in M3" with likes and push tokens that "join here as their slices land", rounds that are "the rest of M4", "no route serves another person's card in M3", conversations written as rows "until #100" (three places), senders that "come later", and a close that #351 "writes; until then". Each says what the code beside it does.
- **A ninth named a month that had passed for work that is still to come.** The on-device photo check's classifier was due "with the October native batch". It is not built: #184 is open and every picture passes on the phone. Its comment says so and names the issue (`apps/mobile/src/features/media/localCheck.ts`).
- **Only these nine were changed.** The same wording still stands in other comments, among them `packages/schema/src/notifications.ts` ("the senders come later") and `apps/api/src/profile/card.ts` ("no route in M3").
- **Four `shortcut:` notes sat inside doc blocks**, where the listing of `CLAUDE.md` (`git grep -E '(//|#) shortcut:'`) passed them by: one in `chat/phone.ts`, one in `identity/lock/LockProvider.tsx`, two in `identity/lock/biometrics.ts`. They are `//` lines above their blocks.

## Names (#679)

- **`report` in the conversation screen.** In `ConversationScreen.tsx` the word meant both the store's function by which a screen reports the newest message it holds (the cursor the socket's next resume names) and whether the conversation takes an abuse report. The first is `reportCursors` in that file. The store's own field keeps its name.
- **`RoundNotice`.** The type in `useRound.ts` listed `"load.failed.press"` three times; it lists it once.
