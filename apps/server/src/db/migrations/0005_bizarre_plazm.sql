CREATE TABLE "document_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"pozicija" integer NOT NULL,
	"article_id" integer,
	"ident" varchar(20) DEFAULT '' NOT NULL,
	"naziv" varchar(400) NOT NULL,
	"kolicina" numeric(14, 2) DEFAULT '1' NOT NULL,
	"cena" numeric(14, 2) DEFAULT '0' NOT NULL,
	"popust" numeric(8, 2) DEFAULT '0' NOT NULL,
	"porez_stopa" numeric(6, 2) DEFAULT '0' NOT NULL,
	"rok_isporuke" varchar(100) DEFAULT '' NOT NULL,
	"napomena" varchar(400) DEFAULT '' NOT NULL,
	"opcioni" boolean DEFAULT false NOT NULL,
	"serijski_broj" varchar(200) DEFAULT '' NOT NULL,
	"nabavna_cena" numeric(14, 2),
	"kalk" jsonb,
	"vracena_kolicina" numeric(14, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_id" integer NOT NULL,
	"to_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"tip" varchar(20) NOT NULL,
	"godina" integer NOT NULL,
	"redni_broj" integer NOT NULL,
	"broj" varchar(30) NOT NULL,
	"status" varchar(100) DEFAULT 'u izradi' NOT NULL,
	"klijent_id" integer,
	"klijent_naziv" varchar(200) DEFAULT '' NOT NULL,
	"klijent_puni_naziv" varchar(400) DEFAULT '' NOT NULL,
	"klijent_pib" varchar(30) DEFAULT '' NOT NULL,
	"klijent_adresa" varchar(300) DEFAULT '' NOT NULL,
	"klijent_postanski_broj" varchar(20) DEFAULT '' NOT NULL,
	"klijent_grad" varchar(100) DEFAULT '' NOT NULL,
	"kontakt_osoba" varchar(200) DEFAULT '' NOT NULL,
	"kontakt_telefon" varchar(60) DEFAULT '' NOT NULL,
	"kontakt_email" varchar(200) DEFAULT '' NOT NULL,
	"adresa_slanja" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"posrednik" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"valuta" varchar(10) DEFAULT 'RSD' NOT NULL,
	"kurs" numeric(12, 4),
	"paritet" varchar(200) DEFAULT '' NOT NULL,
	"nacin_placanja" varchar(200) DEFAULT '' NOT NULL,
	"datum" timestamp DEFAULT now() NOT NULL,
	"rok_vazenja" integer DEFAULT 30 NOT NULL,
	"vazi_do" timestamp,
	"referent_id" integer,
	"referenca_kupca" varchar(200) DEFAULT '' NOT NULL,
	"smer" varchar(15),
	"troskovi_zaglavlje" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_items" ADD CONSTRAINT "document_items_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_items" ADD CONSTRAINT "document_items_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_from_id_documents_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_to_id_documents_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_klijent_id_subjects_id_fk" FOREIGN KEY ("klijent_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_referent_id_users_id_fk" FOREIGN KEY ("referent_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "documents_broj_idx" ON "documents" USING btree ("tip","godina","redni_broj");