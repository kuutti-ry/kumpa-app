# Phase 5: comments and names

What was done is narrow. No sweep of the comments was made: they stand as they were, in their length, their history and their citations, and so does the rule for them in `CLAUDE.md`. Of the audit's sixty renames one was made.

## Comments that were wrong (#678, `9c5c1e70`)

Comments only: each changed file compiles to the same code with its comments stripped.

- **Five stood over the wrong thing**, each a doc comment that had slid above a neighbour's when a constant was added. They were moved, words unchanged: `recordConsent`'s (`apps/api/src/identity/repo.ts`), `ShortPool`'s (`apps/api/src/matching/rounds.ts`), `AccountDeletionRequest`'s and `AccountExport`'s (`packages/schema/src/account.ts`), and the break's notice on the sign-in screen.
- **Nine spoke of work to come that had landed**: the erasure "applied to what exists in M3", likes and push tokens that "join here as their slices land", rounds that are "the rest of M4", "no route serves another person's card in M3", conversations written as rows "until #100" (three places), senders that "come later", a close that #351 "writes; until then", and a classifier due "with the October native batch". Each says what the code beside it does.
- **Four `shortcut:` notes sat inside doc blocks**, where the listing of `CLAUDE.md` (`git grep -E '(//|#) shortcut:'`) passed them by: one in `chat/phone.ts`, one in `identity/lock/LockProvider.tsx`, two in `identity/lock/biometrics.ts`. They are `//` lines above their blocks.

## Names (#679, `214e7d96`)

- **`report` in the conversation screen.** In `ConversationScreen.tsx` the word meant both the store's function that reports how far the socket has read and whether the conversation takes an abuse report. The first is `reportCursors` in that file. The store's own field keeps its name.
- **`RoundNotice`.** The type in `useRound.ts` listed `"load.failed.press"` three times; it lists it once.
