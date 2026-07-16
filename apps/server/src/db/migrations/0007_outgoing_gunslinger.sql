CREATE TABLE "article_stock_levels" (
	"id" serial PRIMARY KEY NOT NULL,
	"article_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"min" numeric(14, 2),
	"opt" numeric(14, 2),
	"max" numeric(14, 2)
);
--> statement-breakpoint
CREATE TABLE "prenos_stavke" (
	"id" serial PRIMARY KEY NOT NULL,
	"prenos_id" integer NOT NULL,
	"article_id" integer NOT NULL,
	"ident" varchar(20) DEFAULT '' NOT NULL,
	"naziv" varchar(400) NOT NULL,
	"kolicina" numeric(14, 2) NOT NULL,
	"serijski_brojevi" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"napomena" varchar(400) DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prenosi" (
	"id" serial PRIMARY KEY NOT NULL,
	"godina" integer NOT NULL,
	"redni_broj" integer NOT NULL,
	"broj" varchar(30) NOT NULL,
	"izdajno_id" integer NOT NULL,
	"prijemno_id" integer NOT NULL,
	"datum" timestamp NOT NULL,
	"napomena" text DEFAULT '' NOT NULL,
	"user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "serial_numbers" (
	"id" serial PRIMARY KEY NOT NULL,
	"article_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"broj" varchar(200) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"article_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"datum" timestamp NOT NULL,
	"kolicina" numeric(14, 2) NOT NULL,
	"vrsta" varchar(20) NOT NULL,
	"ref_id" integer,
	"user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"article_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"mesec" varchar(7) NOT NULL,
	"kolicina" numeric(14, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" serial PRIMARY KEY NOT NULL,
	"naziv" varchar(200) NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "zbirna_nasa_kolicina" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "zbirna_nasa_jm" varchar(20) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "zbirna_dob_kolicina" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "zbirna_dob_jm" varchar(20) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "min_porucivanje" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "korak_porucivanja" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "skladiste_id" integer;--> statement-breakpoint
ALTER TABLE "article_stock_levels" ADD CONSTRAINT "article_stock_levels_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_stock_levels" ADD CONSTRAINT "article_stock_levels_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prenos_stavke" ADD CONSTRAINT "prenos_stavke_prenos_id_prenosi_id_fk" FOREIGN KEY ("prenos_id") REFERENCES "public"."prenosi"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prenos_stavke" ADD CONSTRAINT "prenos_stavke_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prenosi" ADD CONSTRAINT "prenosi_izdajno_id_warehouses_id_fk" FOREIGN KEY ("izdajno_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prenosi" ADD CONSTRAINT "prenosi_prijemno_id_warehouses_id_fk" FOREIGN KEY ("prijemno_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prenosi" ADD CONSTRAINT "prenosi_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serial_numbers" ADD CONSTRAINT "serial_numbers_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serial_numbers" ADD CONSTRAINT "serial_numbers_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_snapshots" ADD CONSTRAINT "stock_snapshots_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_snapshots" ADD CONSTRAINT "stock_snapshots_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_levels_idx" ON "article_stock_levels" USING btree ("article_id","warehouse_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prenosi_broj_idx" ON "prenosi" USING btree ("godina","redni_broj");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_snapshots_idx" ON "stock_snapshots" USING btree ("article_id","warehouse_id","mesec");