-- Research is taken out (ADR-071, #208, the maintainer's word of 2026-11-16): the
-- events go with every monthly partition, which a partitioned table drops with
-- itself, and with the triggers that kept them append-only. A DROP fires no row
-- or TRUNCATE trigger, so the guard of 0001_baseline_sql does not stand in the way.
DROP TABLE IF EXISTS "events" CASCADE;--> statement-breakpoint
DROP FUNCTION IF EXISTS events_immutable();--> statement-breakpoint
-- The rows that name what is going, so that the next migration can rebuild the
-- two enums without them: research consents, whose proof has nothing left to
-- prove, and the researcher's role with its staff sessions. Nobody has opted in
-- outside tests and demos: the app has not asked since #545. A researcher's
-- sessions go whatever role they were opened under, as the moderator CLI's
-- revoke ends them all, so that a later grant revives none of them.
DELETE FROM "consent" WHERE "kind" = 'research';--> statement-breakpoint
DELETE FROM "admin_session" WHERE "identity_id" IN (SELECT "identity_id" FROM "moderator_roles" WHERE "role" = 'researcher');--> statement-breakpoint
DELETE FROM "admin_session" WHERE "role" = 'researcher';--> statement-breakpoint
DELETE FROM "moderator_roles" WHERE "role" = 'researcher';
