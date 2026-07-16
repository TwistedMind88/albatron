CREATE TABLE "poruceno_po_predracunu" (
	"id" serial PRIMARY KEY NOT NULL,
	"predracun_id" integer NOT NULL,
	"porudzbina_id" integer NOT NULL,
	"article_id" integer NOT NULL,
	"kolicina" numeric(14, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_items" ADD COLUMN "potrebe" jsonb;--> statement-breakpoint
ALTER TABLE "document_items" ADD COLUMN "zemlja_porekla" varchar(100) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "document_items" ADD COLUMN "carinska_tarifa" varchar(50) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "document_items" ADD COLUMN "transport_trosak" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "document_items" ADD COLUMN "serijski_brojevi" jsonb;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "broj_fakture" varchar(100) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "datum_fakture" timestamp;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "ukupan_transport" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "serial_numbers" ADD COLUMN "ref_id" integer;--> statement-breakpoint
ALTER TABLE "poruceno_po_predracunu" ADD CONSTRAINT "poruceno_po_predracunu_predracun_id_documents_id_fk" FOREIGN KEY ("predracun_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poruceno_po_predracunu" ADD CONSTRAINT "poruceno_po_predracunu_porudzbina_id_documents_id_fk" FOREIGN KEY ("porudzbina_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poruceno_po_predracunu" ADD CONSTRAINT "poruceno_po_predracunu_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;