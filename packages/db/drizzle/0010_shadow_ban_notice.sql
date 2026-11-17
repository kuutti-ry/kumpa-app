ALTER TYPE "public"."notice_kind" ADD VALUE 'shadow_ban';--> statement-breakpoint
ALTER TABLE "notice" DROP CONSTRAINT "notice_warning_check";--> statement-breakpoint
ALTER TABLE "notice" DROP CONSTRAINT "notice_announcement_check";--> statement-breakpoint
ALTER TABLE "notice" ADD CONSTRAINT "notice_sanction_check" CHECK (("notice"."kind" NOT IN ('invitation_counted', 'invitation_friend', 'announcement')) = ("notice"."sanction_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "notice" ADD CONSTRAINT "notice_announcement_check" CHECK (("notice"."kind" = 'announcement') = ("notice"."announcement_id" IS NOT NULL));