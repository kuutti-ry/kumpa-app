ALTER TYPE "public"."round_decision" RENAME TO "queue_decision";--> statement-breakpoint
ALTER TYPE "public"."round_reason" RENAME TO "queue_reason";--> statement-breakpoint
ALTER TABLE "rounds" RENAME TO "queue_day";--> statement-breakpoint
ALTER TABLE "round_entries" RENAME TO "queue_entry";--> statement-breakpoint
ALTER TABLE "round_relaxation" RENAME TO "queue_relaxation";--> statement-breakpoint
ALTER TABLE "queue_entry" RENAME COLUMN "round_id" TO "queue_day_id";--> statement-breakpoint
ALTER TABLE "queue_relaxation" RENAME COLUMN "round_id" TO "queue_day_id";--> statement-breakpoint
ALTER TABLE "queue_day" RENAME COLUMN "built_at" TO "started_at";--> statement-breakpoint
ALTER TABLE "queue_entry" DROP CONSTRAINT "round_entries_position_check";--> statement-breakpoint
ALTER TABLE "queue_entry" DROP CONSTRAINT "round_entries_decided_check";--> statement-breakpoint
ALTER TABLE "queue_entry" DROP CONSTRAINT "round_entries_fish_check";--> statement-breakpoint
ALTER TABLE "queue_entry" DROP CONSTRAINT "round_entries_second_pass_check";--> statement-breakpoint
ALTER TABLE "queue_entry" DROP CONSTRAINT "round_entries_relaxed_check";--> statement-breakpoint
ALTER TABLE "reward" DROP CONSTRAINT "reward_spent_entry_id_round_entries_id_fk";
--> statement-breakpoint
ALTER TABLE "queue_entry" DROP CONSTRAINT "round_entries_round_id_rounds_id_fk";
--> statement-breakpoint
ALTER TABLE "queue_entry" DROP CONSTRAINT "round_entries_candidate_id_account_id_fk";
--> statement-breakpoint
ALTER TABLE "queue_relaxation" DROP CONSTRAINT "round_relaxation_round_id_rounds_id_fk";
--> statement-breakpoint
ALTER TABLE "queue_day" DROP CONSTRAINT "rounds_account_id_account_id_fk";
--> statement-breakpoint
ALTER TABLE "sanction" ALTER COLUMN "rule" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."sanction_rule";--> statement-breakpoint
CREATE TYPE "public"."sanction_rule" AS ENUM('reports', 'first_messages', 'same_first_message', 'photo_fetches', 'cards_served', 'queue_reads');--> statement-breakpoint
ALTER TABLE "sanction" ALTER COLUMN "rule" SET DATA TYPE "public"."sanction_rule" USING "rule"::"public"."sanction_rule";--> statement-breakpoint
DROP INDEX "round_entries_round_position_idx";--> statement-breakpoint
DROP INDEX "round_entries_candidate_round_idx";--> statement-breakpoint
DROP INDEX "round_relaxation_round_field_idx";--> statement-breakpoint
DROP INDEX "rounds_account_day_idx";--> statement-breakpoint
ALTER TABLE "reward" ADD CONSTRAINT "reward_spent_entry_id_queue_entry_id_fk" FOREIGN KEY ("spent_entry_id") REFERENCES "public"."queue_entry"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_entry" ADD CONSTRAINT "queue_entry_queue_day_id_queue_day_id_fk" FOREIGN KEY ("queue_day_id") REFERENCES "public"."queue_day"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_entry" ADD CONSTRAINT "queue_entry_candidate_id_account_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_relaxation" ADD CONSTRAINT "queue_relaxation_queue_day_id_queue_day_id_fk" FOREIGN KEY ("queue_day_id") REFERENCES "public"."queue_day"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_day" ADD CONSTRAINT "queue_day_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "queue_entry_day_position_idx" ON "queue_entry" USING btree ("queue_day_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "queue_entry_candidate_day_idx" ON "queue_entry" USING btree ("candidate_id","queue_day_id");--> statement-breakpoint
CREATE UNIQUE INDEX "queue_relaxation_day_field_idx" ON "queue_relaxation" USING btree ("queue_day_id","field");--> statement-breakpoint
CREATE UNIQUE INDEX "queue_day_account_day_idx" ON "queue_day" USING btree ("account_id","day");--> statement-breakpoint
ALTER TABLE "queue_day" DROP COLUMN "opened_at";--> statement-breakpoint
ALTER TABLE "queue_day" DROP COLUMN "completed_at";--> statement-breakpoint
ALTER TABLE "queue_entry" ADD CONSTRAINT "queue_entry_position_check" CHECK ("queue_entry"."position" >= 1);--> statement-breakpoint
ALTER TABLE "queue_entry" ADD CONSTRAINT "queue_entry_decided_check" CHECK (("queue_entry"."decision" IS NULL) = ("queue_entry"."decided_at" IS NULL));--> statement-breakpoint
ALTER TABLE "queue_entry" ADD CONSTRAINT "queue_entry_fish_check" CHECK (NOT "queue_entry"."fish" OR "queue_entry"."decision" = 'like');--> statement-breakpoint
ALTER TABLE "queue_entry" ADD CONSTRAINT "queue_entry_second_pass_check" CHECK (NOT "queue_entry"."second_pass" OR "queue_entry"."decision" = 'pass');--> statement-breakpoint
ALTER TABLE "queue_entry" ADD CONSTRAINT "queue_entry_relaxed_check" CHECK (("queue_entry"."reason" = 'relaxed') = ("queue_entry"."relaxed_field" IS NOT NULL)
          AND ("queue_entry"."relaxed_field" IS NULL OR "queue_entry"."relaxed_field" = ANY("queue_entry"."relaxed_with")));