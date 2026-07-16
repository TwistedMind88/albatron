CREATE TABLE "app_settings" (
	"key" varchar(100) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"parent_id" integer,
	"name" varchar(200) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"porez_id" integer,
	"carina" numeric(6, 2)
);
--> statement-breakpoint
CREATE TABLE "lookups" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" varchar(40) NOT NULL,
	"doc_type" varchar(40),
	"internal_value" varchar(200) NOT NULL,
	"external_value" varchar(500) DEFAULT '' NOT NULL,
	"rate" numeric(6, 2),
	"is_default" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_porez_id_lookups_id_fk" FOREIGN KEY ("porez_id") REFERENCES "public"."lookups"("id") ON DELETE no action ON UPDATE no action;