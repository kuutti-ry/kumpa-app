# The simplification audit: what was carried out

A whole-repository audit of 10/11/2026 (#501, pull request #657) proposed nine phases of changes. Every item was checked against the code and the decisions on record, and on 14/11/2026 the maintainer decided which went ahead. These files hold **only what was done**, each with the pull request that did it.

Nothing here is a plan. What the audit proposed and these files do not name was not accepted, and is not waiting to be done: do not build it from the audit's first version in #657's history or from a comment on #501. A new proposal goes to the maintainer as any other does.

## What was done, by phase

| File | What | Where |
|---|---|---|
| `00-bugs.md` | Sixteen defects the audit found, fixed | #671 |
| `01-rules-and-docs.md` | Rule lines and a glossary entry that were false, corrected | #672 |
| `03-delete-tooling.md` | One copied step of the demo reset written once | #673 |
| `06-api.md` | Copies of one rule written once, a dead option removed, one guard moved to its source | #660, #661, #673, #674, #675 |
| `07-mobile.md` | One defect of the onboarding's read, fixed | #676 |
| `08-admin-and-packages.md` | Two defects of the moderation panel, fixed | #670 |

Phases 2 (the checks and hooks of a pull request), 4 (the tests) and 5 (comments and names) have no file: nothing of them was carried out. The checks, the hooks, the coverage floors and the scenarios stand as they were, and no test was removed to make the suite smaller.

## Where the changes are

- #660, #661, #670 and #671 are on `main`.
- #672 to #676 were merged on 14/11/2026 into the branch `refactor/657-simplification`, which gathers this work and reaches `main` as one pull request. Until that pull request has merged, those five are not on `main`.

## How the items were weighed

The maintainer's word of 14/11/2026: the code is written and kept by agents, so fewer lines, fewer words or easier reading by a person is no gain by itself; no existing test is modified unless its code is removed; and a change that goes against a decision made earlier is not built. What counted was one place for one rule, a real defect, a statement that is false today, and code nothing uses.
