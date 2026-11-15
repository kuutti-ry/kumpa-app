ALTER TABLE "account" DROP CONSTRAINT "account_pond_id_ponds_id_fk";
--> statement-breakpoint
ALTER TABLE "pond_counter" DROP CONSTRAINT "pond_counter_pond_id_ponds_id_fk";
--> statement-breakpoint
ALTER TABLE "account" DROP COLUMN "pond_id";--> statement-breakpoint
ALTER TABLE "pond_counter" DROP COLUMN "pond_id";