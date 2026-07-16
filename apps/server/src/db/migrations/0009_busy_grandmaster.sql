CREATE TABLE "avans_veze" (
	"id" serial PRIMARY KEY NOT NULL,
	"avans_id" integer NOT NULL,
	"racun_id" integer NOT NULL,
	"iznos" numeric(14, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_items" ADD COLUMN "preneta_kolicina" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "avans_predracun_broj" varchar(30) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "avans_osnovica" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "avans_iznos" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "serial_numbers" ADD COLUMN "izlaz_id" integer;--> statement-breakpoint
ALTER TABLE "avans_veze" ADD CONSTRAINT "avans_veze_avans_id_documents_id_fk" FOREIGN KEY ("avans_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "avans_veze" ADD CONSTRAINT "avans_veze_racun_id_documents_id_fk" FOREIGN KEY ("racun_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;