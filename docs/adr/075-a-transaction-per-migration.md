# ADR-075: A transaction per migration

- Status: proposed (#722, the maintainer's choice of 2026-11-18 in chat among the issue's three ways: a transaction per migration; built as written here; accepting it is his)
- Date: 2026-11-18
- Follows: CLAUDE.md rule 10 (migrations are generated and applied by the entrypoint under an advisory lock), ADR-065 §1 and §5 (the mechanism stays; a database with the old journal refuses the baseline), ADR-049 §2 (the API deployed to production by hand on a pinned commit), `.claude/rules/db.md` (the manual snapshot before a release-tag migration), #25; ADR-044 §3's reason for one migration no longer holds (its History)

## Context

drizzle's migrator for node-postgres applies every pending migration inside one transaction (`PgDialect.migrate` under `session.transaction`, in drizzle-orm 0.45). Postgres does not let a transaction use an enum value it added until it commits (55P04, "New enum values must be committed before they can be used"), unless the type itself was created in the same transaction.

`0002_announcements.sql` adds `announcement` to `notice_kind`, and `0010_shadow_ban_notice.sql` names it in a check. Nothing showed the collision:

- A fresh database (CI, a laptop, `migrate.test.ts`) creates `notice_kind` in `0000_baseline.sql`, in the same transaction, so the whole chain passes.
- Staging boots once per merge, so `0002` and `0010` were applied weeks apart.
- Only a database behind by a span that both adds a value and uses it fails: production at every tag, a restored backup, a long-lived local database.

The production rehearsal `v0.126.0-rehearsal.1` of 2026-11-17 took production from 0.108.2 to 0.126.0, after ADR-065 §5's stamp, and its boot stopped there. The transaction rolled back whole, Swarm kept the old task, and `/health` went on naming the old commit while Dokploy reported the deployment as finished. Nothing was damaged, and production crossed in two boots (#25).

The issue named three ways, and the maintainer chose the first on 2026-11-18 (#722): a transaction per migration; one transaction and a test that takes a database from each earlier migration to the end; one transaction committed after a migration that adds an enum value.

## Decision

1. **Each pending migration commits on its own**, in the journal's order, under the one advisory lock held for the whole run (`packages/db/src/migrate.ts`). A migration's statements and its line in the journal commit together, or neither does.

2. **drizzle's bookkeeping stays drizzle's.** drizzle-orm's `readMigrationFiles` reads the folder: the statements split at drizzle-kit's breakpoints, and each file's SHA-256. The journal table is `drizzle.__drizzle_migrations` as drizzle makes it. A migration is pending when drizzle calls it pending: when its `when` is newer than the last line's. So `migrationsStatus`, `/health` and ADR-065 §5's stamp read the same rows as before, and drizzle's own migrator would find nothing to do on a database this one migrated. drizzle-kit still writes every file (rule 10). Since `when` decides, the boot refuses a journal with an entry not dated after the one before it, naming both, before it connects: drizzle-kit dates an entry by the clock of the machine that generated it, and a database that has committed the earlier one would skip such an entry for good, after a refusal midway or on staging after a merge.

3. **Every database takes the same path.** A fresh database applies the baseline in one transaction and each later migration in one of its own. A database behind by any span applies them exactly the same way. So CI's fresh database, staging's merges one at a time and production's tags cannot differ by where the span is cut. A migration that adds an enum value and uses it itself now fails on a fresh database too, in CI, before it reaches anybody.

4. **A refused migration rolls back alone.** The boot stops before the server listens. Its error reads `migration <tag> failed and was rolled back; this run applied <n> before it`. Its cause is the database's error kept to its kind: the code, the severity, and the schema, table, column, constraint and routine it names. The boot prints the error to the log as it is, and a database error's message, detail, hint and where can quote a row (a duplicate key, a failing row), so they stay out, as the logger keeps them out (`lib/logger.ts`, #636). The migrations before it stay applied, with their lines. The lock is released, and the next boot carries on from the refused one. ADR-065 §5 is unchanged: a database with the old journal fails at the baseline's first statement, so nothing is applied and everything is as it was.

5. **A deploy is proved by `/health`, never by Dokploy's word.** The release steps in `infra/README.md` (Build provenance) say what a refused migration looks like on the box, and that a deploy by hand is done when `/health` names its commit. `deploy.yml` already waits for that (`wait-healthy.sh`).

## Consequences

- The cost the maintainer accepted: a refusal midway leaves the database between two releases while the old image serves it, where one transaction left it as it was. The old image may not serve every route against a schema ahead of its own. The way forward is the fixed image, whose boot carries on from the refused migration. The way back is the manual snapshot taken before a release-tag migration.
- The old image's `/health` says `migrations: current` meanwhile: it reads the database against its own, shorter journal. The commit it names is what tells the deploy did not land.
- `0002` and `0010` need no exemption, and a later enum value is written the way drizzle-kit writes it.
- `migrate.test.ts` takes a database at the baseline through every later migration in one boot (the reproduction), holds a refusal midway to point 4, holds a refusal's cause to its kind with a duplicate address under a unique index, and refuses a journal with an entry dated at the moment of the one before it or earlier (point 2). In `cli.attack.test.ts`, the attack that held a failed run to "nothing applied" now holds what both designs forbid: a migration's change standing without its line in the journal.
- A statement Postgres refuses inside a transaction (`CREATE INDEX CONCURRENTLY`, `VACUUM`) is still refused, since each migration still runs in one.

## Left out on purpose, and what would make it needed

- **One transaction, and a test from each earlier migration to the end.** It keeps all-or-nothing. But today's chain fails it at once (a database at `0001`), so it would start with an exemption. Also, every enum value a later migration uses would have to be written by hand as `--custom`, or its type rebuilt as `0009` and `0013` rebuild theirs, because a generated file is never edited. All-or-nothing would be needed if a release's migrations ever have to land together for the old image to keep working. That is a reason to write them as one migration.
- **One transaction, committed after a migration that adds an enum value.** All-or-nothing everywhere else. But it depends on reading `ADD VALUE` in the SQL's text, and any other statement Postgres will not run in a transaction with what follows it would need a rule of its own.
- **drizzle's migrator called once per migration**, through a temporary folder per step or the dialect's `migrate`, which drizzle marks internal. Same result, through a copy of the folder or an API that is not drizzle's to promise.

## History

- 2026-11-17: the rehearsal's refusal; #722 opened. Production crossed in two boots: main's attested image of d8a14495 (`0002` to `0009`), then 063d05f4 (`0010` to `0013`), recorded on #25.
- 2026-11-18: the maintainer chose a transaction per migration. Built as written here, with the reproduction test from the baseline. The security review of the change added the journal's order (point 2) and the cause kept to its kind (point 4).
