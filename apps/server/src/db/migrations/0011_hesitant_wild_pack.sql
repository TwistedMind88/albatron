ALTER TABLE "documents" ALTER COLUMN "broj" SET DATA TYPE varchar(60);--> statement-breakpoint
ALTER TABLE "pricelist_items" ADD COLUMN "discontinued" boolean DEFAULT false NOT NULL;