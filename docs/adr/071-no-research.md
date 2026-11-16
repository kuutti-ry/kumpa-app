# ADR-071: No research: the consent, the events, the copy and the researcher taken out

- Status: proposed (#208, built as written here on the maintainer's word of 2026-11-16 in a session: "research opt-in or out is irrelevant for now, remove from the app and from the website for now", then "wipe all research stuff including opt-in, we'll rebuild, if requested"; accepting this record is his)
- Date: 2026-11-16
- Follows: TD-5 (research use of events needs its own yes, and the events never carry text), TD-7 (the erasure table named the `research_id` mapping), TD-4 (AWS in eu-central-1), CLAUDE.md rules 5 and 10, ADR-010 (amended here: the research kind), ADR-011 and ADR-029 (superseded here), ADR-001 (Identity Center), #208, #545, #194

## Context

Research was built before there was a researcher. ADR-011 gave it a consent of its own, a random pseudonym (`research_subject`), server-written events from a fixed registry, and a partitioned, append-only `events` table kept 90 days. ADR-029 added a nightly anonymised copy on S3 with its census, and a researcher's read-only role with an access trail. Since #545 (ADR-010 §19) the app no longer asks for the research consent, so nothing was written outside tests and demos. R3 Research (#50, #98, #104, #195, #194) waits for researchers who have not been met.

The research opt-in stayed the draft it was. A release refuses a draft legal text (ADR-010 §7), so the draft held up the release that #208 prepares. On 2026-11-16 the maintainer first asked to remove the opt-in from the app and the website. Then he asked to remove all of research: "wipe all research stuff including opt-in, we'll rebuild, if requested".

## Decision

1. **No research consent.** The kind `research` leaves `CONSENT_KINDS`, the database enum `consent_kind`, the app's texts (`legal.research.*` and the switch, the question and the step that were hidden since #545) and the website (`kuutti-ry/kumpa-app-site`, its consent page and versions). The rows of the kind are deleted, since they prove a yes to something that no longer exists.
2. **No events.** `track()`, the registry `packages/schema/src/research.ts` with its age bands and the bands of seconds, of a message's length and of a contact share, and every call that wrote an event all go. So do the table `events` with its monthly partitions and its append-only guard, and the mapping `research_subject`.
3. **No copy.** The nightly jobs go: the partitions, the census of the live table, and the copy to S3 with its census. So do the copy store, `infra/modules/research` (the API's write-once rights, the researcher's role, the access trail and its bucket), the media bucket's lifecycle rule for the copy, and the alarm pattern for events dropped without their copy.
4. **No researcher.** The staff role `researcher` leaves the enum `moderator_role`, the moderator CLI, the API's role checks and the panel, along with the panel's text for a role that opens no screen. Its role rows and staff sessions are deleted.
5. **The person's data.** The export loses its research section, erasure its research steps (`removeResearchSubject`), and the register in `apps/api/src/identity/personal-data.test.ts` its two tables. The privacy policy never described research processing beyond the opt-in's own text, so no other legal text changes and no version is bumped.
6. **What stays.**
   - CLAUDE.md's rule 5 stays, as the condition any rebuild starts from.
   - So does the queue's rule that nothing in it waits on a research partner (#502, ADR-062).
   - So does the absence of a private check-in after a date until a research partner asks for one (#104).
   - ADR-011 and ADR-029 are kept for their reasoning.
7. **A rebuild is a new record,** when a researcher asks. It starts from ADR-011 and ADR-029 and from the open questions they left, which were never settled.

The SQL, which the schema DSL could not express (rule 10), is `packages/db/drizzle/0008_no_research.sql`, generated with `--custom`:

```sql
DROP TABLE IF EXISTS "events" CASCADE;
DROP FUNCTION IF EXISTS events_immutable();
DELETE FROM "consent" WHERE "kind" = 'research';
DELETE FROM "admin_session" WHERE "identity_id" IN (SELECT "identity_id" FROM "moderator_roles" WHERE "role" = 'researcher');
DELETE FROM "admin_session" WHERE "role" = 'researcher';
DELETE FROM "moderator_roles" WHERE "role" = 'researcher';
```

A partitioned table drops with its partitions, and a `DROP` fires none of the row or `TRUNCATE` triggers that guarded it. A researcher's sessions go whatever role they were opened under, as the moderator CLI's revoke ends every session of the identity, so that a later grant of another role revives none of them. The deletions come first so that the generated `0009_no_research_kinds.sql` can drop `research_subject` and rebuild the two enums without the values: Postgres cannot drop a value from an enum, so drizzle-kit casts the column to text, recreates the type and casts back, which fails on a row that still names the value.

## Consequences

- ADR-011 and ADR-029 are superseded by this record, and ADR-010 is amended (§4, §9, §15 and §19 no longer have a research kind to speak of). Other records also set research points: ADR-007 §4, ADR-019 §4, ADR-022 §2 and §7, ADR-023 §3, ADR-030 §9, ADR-031 §7, §10 and §11, ADR-034 §6, ADR-038 §5, ADR-039 §5, ADR-040 §4 and §5, ADR-042 §10, ADR-044 §11, ADR-061 §9, ADR-062 §15 and ADR-064 §8 and §10. Their research points lapse with the events, and each says so in its History.
- The docs, the rules and the drawings lose research: the register's Research section is one row, and the research slice is gone from the layout.
- Retention loses the 90 days of the events and the copy's open questions; the copy is no longer kept and the access log is no longer kept.
- An app bundle from before this change parses `GET /onboarding` and `GET /consents` with the research fields required, which the API no longer sends, so its onboarding gate (`useOnboardingGate`) and the consent switches fail until its EAS Update applies. With `checkAutomatically: ON_LOAD` and `fallbackToCacheTimeout: 0`, the update applies at the launch after it downloads, and the deploy publishes it with the API. The fingerprint does not move, so it reaches installed builds over the air, as in ADR-027. No real person uses the app before the opening.
- The website goes second. The app's `pnpm check:legal-versions` tolerates the site still publishing `research` (`RETIRED_KINDS`, a `shortcut:` until the site's change is deployed), and the site's own check of the app's kinds then passes once this change is on `main`.
- The infra goes in two applies. First the trail's versioned bucket gets `force_destroy` (#208's preparatory change), so that the apply of this change can delete it with its logs and its hourly digests. What tofu does not hold is the maintainer's:
  - the permission set `KuuttiResearchStaging` in Identity Center, made by hand;
  - the copy's files under `research/` in staging's media bucket. Removing the lifecycle rule deletes nothing.
  Production never had either.

## Open, the maintainer's

- Whether to delete staging's copy under `research/` now, or let it stand until staging is rebuilt. It holds only staging's invented people (ADR-018).
- Whether a rebuild, if it comes, starts from ADR-011 as it was or from a new consent and event design.

## Alternatives

- **Removing only the opt-in** (his first word) would have left `track()`, the events, the copy and the researcher's role with no consent to rest on: code with no reachable path, which CLAUDE.md removes.
- **Keeping the draft and refusing the release** keeps a legal text nobody will be asked. #208's release waits on it, for a feature that waits on people not yet met.

## History

- 2026-11-16 (#208): written and built on the maintainer's word of that day in a session.
