# Phase 1: the agents' rules

What was done here is narrow: sentences in the rules files that were false against the code were corrected (#672, `a393677d`). `CLAUDE.md` and the rules files otherwise stand as they were, in their length and their wording.

| File | It said | It says now |
|---|---|---|
| `.claude/rules/layout.md` | The moderation panel has no notifications slice | The panel's notifications slice holds the announcements (#573) |
| | Matching's files include `filters.ts` | The files that exist: `routes.ts`, `round-routes.ts`, `rounds.ts`, `pool.ts` |
| | Every slice of the API has a `service.ts` | A slice has its routes, a file per job, and `repo.ts` where it keeps its SQL apart |
| | The phone's theme is in `src/lib` | The theme is `src/theme`; `src/components` holds the shared pieces |
| `.claude/rules/schema.md` | Three branded ids, two of which never existed | `PhotoId` is the one branded id |
| `.claude/rules/i18n.md` | CI compiles per-locale JSON | `pnpm i18n:build` writes `src/generated/`, which is committed |
| `.claude/rules/db.md` | The seed creates a few hundred fake users | The seed writes the pond, `matching_config` and three identities; people to try the app with come from the demo tools |
| `packages/i18n/glossary.yaml` | The round is a small, fixed daily set | The round is a queue with no fixed size that ends (ADR-062 §1) |

`docs/architecture/components.md` names `layout.md` among the files it draws, and was redrawn with it (ADR-047): the notifications row and its step, and the specs that exist.
