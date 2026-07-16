CREATE TABLE "pricelist_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"pricelist_id" integer NOT NULL,
	"sku" varchar(100) NOT NULL,
	"naziv" varchar(400) DEFAULT '' NOT NULL,
	"cena" numeric(14, 2),
	"opis" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricelists" (
	"id" serial PRIMARY KEY NOT NULL,
	"naziv" varchar(300) NOT NULL,
	"dobavljac_id" integer NOT NULL,
	"valuta" varchar(10) DEFAULT 'EUR' NOT NULL,
	"vazi_od" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pricelist_items" ADD CONSTRAINT "pricelist_items_pricelist_id_pricelists_id_fk" FOREIGN KEY ("pricelist_id") REFERENCES "public"."pricelists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricelists" ADD CONSTRAINT "pricelists_dobavljac_id_subjects_id_fk" FOREIGN KEY ("dobavljac_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;