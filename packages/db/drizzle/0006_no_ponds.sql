ALTER TABLE "ponds" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "ponds" CASCADE;--> statement-breakpoint
ALTER TABLE "pond_counter" ADD COLUMN "id" boolean PRIMARY KEY DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "pond_counter" ADD CONSTRAINT "pond_counter_one_row_check" CHECK ("pond_counter"."id");