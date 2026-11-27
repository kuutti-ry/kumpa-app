CREATE TABLE "unsubscribe_token" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unsubscribe_token_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "unsubscribe_token" ADD CONSTRAINT "unsubscribe_token_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;