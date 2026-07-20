CREATE TABLE "obavestenja" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"tip" varchar(30) NOT NULL,
	"naslov" varchar(300) NOT NULL,
	"tekst" text DEFAULT '' NOT NULL,
	"link_tip" varchar(20),
	"link_id" integer,
	"procitano" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "obavestenja_pretplate" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"tip" varchar(30) NOT NULL,
	"dokument_tip" varchar(20) DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_items" ADD COLUMN "izvor_stavka_id" integer;--> statement-breakpoint
ALTER TABLE "obavestenja" ADD CONSTRAINT "obavestenja_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obavestenja_pretplate" ADD CONSTRAINT "obavestenja_pretplate_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "obavestenja_pretplata_uniq" ON "obavestenja_pretplate" USING btree ("user_id","tip","dokument_tip");--> statement-breakpoint
ALTER TABLE "document_items" ADD CONSTRAINT "document_items_izvor_stavka_id_document_items_id_fk" FOREIGN KEY ("izvor_stavka_id") REFERENCES "public"."document_items"("id") ON DELETE set null ON UPDATE no action;