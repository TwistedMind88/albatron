CREATE TABLE "akcija_istorija" (
	"id" serial PRIMARY KEY NOT NULL,
	"article_id" integer NOT NULL,
	"procenat" numeric(8, 2),
	"od" timestamp,
	"do_datuma" timestamp,
	"neograniceno" boolean DEFAULT false NOT NULL,
	"user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "article_attributes" (
	"id" serial PRIMARY KEY NOT NULL,
	"article_id" integer NOT NULL,
	"value" varchar(200) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "article_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"article_id" integer NOT NULL,
	"filename" varchar(300) NOT NULL,
	"stored_path" varchar(500) NOT NULL,
	"is_image" boolean DEFAULT false NOT NULL,
	"auto_attach" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "articles" (
	"id" serial PRIMARY KEY NOT NULL,
	"ident" varchar(6) NOT NULL,
	"tip" varchar(15) DEFAULT 'obican' NOT NULL,
	"parent_id" integer,
	"naziv" varchar(300) NOT NULL,
	"opis" text DEFAULT '' NOT NULL,
	"napomena" text DEFAULT '' NOT NULL,
	"dobavljac_id" integer,
	"sku" varchar(100) DEFAULT '' NOT NULL,
	"prodajna_cena" numeric(14, 2),
	"prodajna_valuta" varchar(10) DEFAULT 'RSD' NOT NULL,
	"kurs" numeric(12, 4),
	"marza" numeric(8, 2),
	"dobavljaceva_cena" numeric(14, 2),
	"dobavljaceva_valuta" varchar(10) DEFAULT 'RSD' NOT NULL,
	"ocekivani_popust" numeric(8, 2),
	"carinska_stopa" numeric(8, 2),
	"sertifikacija_stopa" numeric(8, 2),
	"zemlja_porekla" varchar(100) DEFAULT '' NOT NULL,
	"carinska_tarifa" varchar(50) DEFAULT '' NOT NULL,
	"porez_id" integer,
	"glavna_kategorija_id" integer,
	"sekundarna_kategorija_id" integer,
	"active" boolean DEFAULT true NOT NULL,
	"discontinued" boolean DEFAULT false NOT NULL,
	"akcija_procenat" numeric(8, 2),
	"akcija_od" timestamp,
	"akcija_do" timestamp,
	"akcija_neograniceno" boolean DEFAULT false NOT NULL,
	"serijski_brojevi" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "articles_ident_unique" UNIQUE("ident")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity" varchar(50) NOT NULL,
	"entity_id" integer NOT NULL,
	"field" varchar(100) NOT NULL,
	"old_value" text,
	"new_value" text,
	"user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "related_articles" (
	"id" serial PRIMARY KEY NOT NULL,
	"article_id" integer NOT NULL,
	"related_id" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "akcija_istorija" ADD CONSTRAINT "akcija_istorija_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "akcija_istorija" ADD CONSTRAINT "akcija_istorija_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_attributes" ADD CONSTRAINT "article_attributes_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_files" ADD CONSTRAINT "article_files_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_dobavljac_id_subjects_id_fk" FOREIGN KEY ("dobavljac_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_porez_id_lookups_id_fk" FOREIGN KEY ("porez_id") REFERENCES "public"."lookups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_glavna_kategorija_id_categories_id_fk" FOREIGN KEY ("glavna_kategorija_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_sekundarna_kategorija_id_categories_id_fk" FOREIGN KEY ("sekundarna_kategorija_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "related_articles" ADD CONSTRAINT "related_articles_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "related_articles" ADD CONSTRAINT "related_articles_related_id_articles_id_fk" FOREIGN KEY ("related_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;