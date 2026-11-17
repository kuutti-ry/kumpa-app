-- The round is the queue in the code too (#695, ADR-062 §1 as amended
-- 17/11/2026; the maintainer's "Also rename to queue" on #607, 15/11/2026).
-- What the schema DSL cannot say, before 0013 renames the tables, their
-- columns, indexes, checks, foreign keys and enums:
-- the velocity rule's value moves in place, so the sanctions it applied keep
-- their rule, and 0013's recreated type finds no row it cannot cast;
-- the rule's two tunables move whole, every version with its value, its
-- number and who wrote it (ADR-013 §17);
-- the three primary keys, which Postgres names after the table and
-- drizzle-kit does not see, take the tables' new names.
ALTER TYPE "public"."sanction_rule" RENAME VALUE 'round_reads' TO 'queue_reads';--> statement-breakpoint
UPDATE "matching_config" SET "key" = 'auto_shadow_ban_queue_reads' WHERE "key" = 'auto_shadow_ban_round_reads';--> statement-breakpoint
UPDATE "matching_config" SET "key" = 'auto_shadow_ban_queue_reads_minutes' WHERE "key" = 'auto_shadow_ban_round_reads_minutes';--> statement-breakpoint
ALTER TABLE "rounds" RENAME CONSTRAINT "rounds_pkey" TO "queue_day_pkey";--> statement-breakpoint
ALTER TABLE "round_entries" RENAME CONSTRAINT "round_entries_pkey" TO "queue_entry_pkey";--> statement-breakpoint
ALTER TABLE "round_relaxation" RENAME CONSTRAINT "round_relaxation_pkey" TO "queue_relaxation_pkey";
