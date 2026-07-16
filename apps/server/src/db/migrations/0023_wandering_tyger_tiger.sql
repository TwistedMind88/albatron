ALTER TABLE "documents" ADD COLUMN "locked_by" integer;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "lock_heartbeat" timestamp;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;