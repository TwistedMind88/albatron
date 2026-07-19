CREATE TABLE "popis_stavke" (
	"id" serial PRIMARY KEY NOT NULL,
	"popis_id" integer NOT NULL,
	"article_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"ident" varchar(20) DEFAULT '' NOT NULL,
	"naziv" varchar(400) NOT NULL,
	"ocekivano" numeric(14, 2) NOT NULL,
	"popisano" numeric(14, 2),
	"datum_popisa" timestamp
);
--> statement-breakpoint
CREATE TABLE "popisi" (
	"id" serial PRIMARY KEY NOT NULL,
	"godina" integer NOT NULL,
	"redni_broj" integer NOT NULL,
	"broj" varchar(30) NOT NULL,
	"datum" timestamp NOT NULL,
	"status" varchar(10) DEFAULT 'u_toku' NOT NULL,
	"napomena" text DEFAULT '' NOT NULL,
	"kriterijumi" jsonb NOT NULL,
	"user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "presifriranja" (
	"id" serial PRIMARY KEY NOT NULL,
	"godina" integer NOT NULL,
	"redni_broj" integer NOT NULL,
	"broj" varchar(30) NOT NULL,
	"datum" timestamp NOT NULL,
	"status" varchar(10) DEFAULT 'nacrt' NOT NULL,
	"napomena" text DEFAULT '' NOT NULL,
	"user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "presifriranje_stavke" (
	"id" serial PRIMARY KEY NOT NULL,
	"presifriranje_id" integer NOT NULL,
	"smer" varchar(5) NOT NULL,
	"article_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"ident" varchar(20) DEFAULT '' NOT NULL,
	"naziv" varchar(400) NOT NULL,
	"kolicina" numeric(14, 2) NOT NULL,
	"serijski_brojevi" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prenosi" ADD COLUMN "status" varchar(10) DEFAULT 'knjizen' NOT NULL;--> statement-breakpoint
ALTER TABLE "prenosi" ADD COLUMN "popis_id" integer;--> statement-breakpoint
ALTER TABLE "serial_numbers" ADD COLUMN "izlaz_vrsta" varchar(20);--> statement-breakpoint
ALTER TABLE "popis_stavke" ADD CONSTRAINT "popis_stavke_popis_id_popisi_id_fk" FOREIGN KEY ("popis_id") REFERENCES "public"."popisi"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "popis_stavke" ADD CONSTRAINT "popis_stavke_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "popis_stavke" ADD CONSTRAINT "popis_stavke_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "popisi" ADD CONSTRAINT "popisi_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presifriranja" ADD CONSTRAINT "presifriranja_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presifriranje_stavke" ADD CONSTRAINT "presifriranje_stavke_presifriranje_id_presifriranja_id_fk" FOREIGN KEY ("presifriranje_id") REFERENCES "public"."presifriranja"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presifriranje_stavke" ADD CONSTRAINT "presifriranje_stavke_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presifriranje_stavke" ADD CONSTRAINT "presifriranje_stavke_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "popis_stavke_idx" ON "popis_stavke" USING btree ("popis_id","article_id","warehouse_id");--> statement-breakpoint
CREATE UNIQUE INDEX "popisi_broj_idx" ON "popisi" USING btree ("godina","redni_broj");--> statement-breakpoint
CREATE UNIQUE INDEX "presifriranja_broj_idx" ON "presifriranja" USING btree ("godina","redni_broj");