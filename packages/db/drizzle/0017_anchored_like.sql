CREATE TYPE "public"."like_anchor_kind" AS ENUM('photo', 'prompt', 'bio', 'shared');--> statement-breakpoint
ALTER TABLE "conversation_participant" ADD COLUMN "anchor_kind" "like_anchor_kind";--> statement-breakpoint
ALTER TABLE "conversation_participant" ADD COLUMN "anchor_ref" text;--> statement-breakpoint
ALTER TABLE "conversation_participant" ADD COLUMN "anchor_field" text;--> statement-breakpoint
ALTER TABLE "queue_entry" ADD COLUMN "anchor_kind" "like_anchor_kind";--> statement-breakpoint
ALTER TABLE "queue_entry" ADD COLUMN "anchor_ref" text;--> statement-breakpoint
ALTER TABLE "queue_entry" ADD COLUMN "anchor_field" text;--> statement-breakpoint
ALTER TABLE "conversation_participant" ADD CONSTRAINT "conversation_participant_anchor_check" CHECK (("conversation_participant"."anchor_kind" IS NULL OR "conversation_participant"."anchor_kind" = 'bio') = ("conversation_participant"."anchor_ref" IS NULL)
          AND ("conversation_participant"."anchor_kind" IS NOT DISTINCT FROM 'shared') = ("conversation_participant"."anchor_field" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "queue_entry" ADD CONSTRAINT "queue_entry_anchor_check" CHECK ("queue_entry"."anchor_kind" IS NULL OR "queue_entry"."decision" = 'like');--> statement-breakpoint
ALTER TABLE "queue_entry" ADD CONSTRAINT "queue_entry_anchor_ref_check" CHECK (("queue_entry"."anchor_kind" IS NULL OR "queue_entry"."anchor_kind" = 'bio') = ("queue_entry"."anchor_ref" IS NULL)
          AND ("queue_entry"."anchor_kind" IS NOT DISTINCT FROM 'shared') = ("queue_entry"."anchor_field" IS NOT NULL));