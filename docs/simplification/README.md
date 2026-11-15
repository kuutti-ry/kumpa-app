# The simplification audit: what was carried out

A whole-repository audit of 10/11/2026 (#501, pull request #657) proposed nine phases of changes. Every item was checked against the code and the decisions on record, and on 14/11/2026 the maintainer decided which went ahead. These files hold **only what was done**, each with the pull request that did it.

Nothing here is a plan. What the audit proposed and these files do not name was not accepted, and is not waiting to be done: do not build it from the audit's first version in #657's history or from a comment on #501. A new proposal goes to the maintainer as any other does.

## What was done, by phase

| File | What | Where |
|---|---|---|
| `00-bugs.md` | Sixteen defects the audit found, fixed | #671 |
| `01-rules-and-docs.md` | Rule lines and a glossary entry that were false, corrected | #672 |
| `03-delete-tooling.md` | One copied step of the demo reset written once | #673 |
| `05-comments-and-names.md` | Comments that were wrong corrected, one name given one meaning, two dead lines of a type removed | #678, #679 |
| `06-api.md` | Copies of one rule written once, a dead option removed, one guard moved to its source | #660, #661, #673, #674, #675 |
| `07-mobile.md` | One defect of the onboarding's read, fixed | #676 |
| `08-admin-and-packages.md` | Two defects of the moderation panel, fixed; one limit read from its constant | #670, #679 |

Phases 2 (the checks and hooks of a pull request) and 4 (the tests) have no file: nothing of them was carried out. The checks, the hooks, the coverage floors and the scenarios stand as they were, and no test was removed to make the suite smaller.

## Where the changes are

- #660, #661, #670 and #671 reached `main` on their own.
- #672 to #676, #678 and #679 were gathered on the branch `refactor/657-simplification` on 14/11/2026 and reached `main` together, as #680's one commit. #680 also carries what a review of the whole found: the onboarding guard made sturdier, and the last route's copy of the `Retry-After` rule removed.

## How the items were weighed

The maintainer's word of 14/11/2026: the code is written and kept by agents, so fewer lines, fewer words or easier reading by a person is no gain by itself; no existing test is modified unless its code is removed (one was, on his word: three title assertions of the panel's `app.test.tsx` wait for the title, a flake that failed #675's checks, with no expected value changed); and a change that goes against a decision made earlier is not built. What counted was one place for one rule, a real defect, a statement that is false today, and code nothing uses.
