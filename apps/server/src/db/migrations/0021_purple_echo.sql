ALTER TABLE "pricelist_items" ADD COLUMN "napomena" varchar(400) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "pricelist_items" ADD COLUMN "custom" jsonb;