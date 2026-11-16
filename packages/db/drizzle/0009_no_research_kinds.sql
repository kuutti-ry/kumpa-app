DROP TABLE "research_subject" CASCADE;--> statement-breakpoint
ALTER TABLE "consent" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."consent_kind";--> statement-breakpoint
CREATE TYPE "public"."consent_kind" AS ENUM('terms', 'privacy', 'special_category');--> statement-breakpoint
ALTER TABLE "consent" ALTER COLUMN "kind" SET DATA TYPE "public"."consent_kind" USING "kind"::"public"."consent_kind";--> statement-breakpoint
ALTER TABLE "admin_session" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "moderator_roles" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."moderator_role";--> statement-breakpoint
CREATE TYPE "public"."moderator_role" AS ENUM('moderator', 'admin');--> statement-breakpoint
ALTER TABLE "admin_session" ALTER COLUMN "role" SET DATA TYPE "public"."moderator_role" USING "role"::"public"."moderator_role";--> statement-breakpoint
ALTER TABLE "moderator_roles" ALTER COLUMN "role" SET DATA TYPE "public"."moderator_role" USING "role"::"public"."moderator_role";