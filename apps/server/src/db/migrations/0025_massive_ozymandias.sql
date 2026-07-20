CREATE TABLE "zadaci" (
	"id" serial PRIMARY KEY NOT NULL,
	"naziv" varchar(300) NOT NULL,
	"opis" text DEFAULT '' NOT NULL,
	"subjekt_id" integer,
	"dokument_id" integer,
	"rok" timestamp,
	"prioritet" varchar(10) DEFAULT 'srednji' NOT NULL,
	"status" varchar(10) DEFAULT 'aktivan' NOT NULL,
	"kreirao_id" integer NOT NULL,
	"zavrsio_id" integer,
	"zavrseno_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zadatak_izvrsioci" (
	"id" serial PRIMARY KEY NOT NULL,
	"zadatak_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"status" varchar(10) DEFAULT 'pozvan' NOT NULL,
	"pozvao_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"responded_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "zadatak_opisi" (
	"id" serial PRIMARY KEY NOT NULL,
	"zadatak_id" integer NOT NULL,
	"tekst" text NOT NULL,
	"autor_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "zadaci" ADD CONSTRAINT "zadaci_subjekt_id_subjects_id_fk" FOREIGN KEY ("subjekt_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zadaci" ADD CONSTRAINT "zadaci_dokument_id_documents_id_fk" FOREIGN KEY ("dokument_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zadaci" ADD CONSTRAINT "zadaci_kreirao_id_users_id_fk" FOREIGN KEY ("kreirao_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zadaci" ADD CONSTRAINT "zadaci_zavrsio_id_users_id_fk" FOREIGN KEY ("zavrsio_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zadatak_izvrsioci" ADD CONSTRAINT "zadatak_izvrsioci_zadatak_id_zadaci_id_fk" FOREIGN KEY ("zadatak_id") REFERENCES "public"."zadaci"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zadatak_izvrsioci" ADD CONSTRAINT "zadatak_izvrsioci_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zadatak_izvrsioci" ADD CONSTRAINT "zadatak_izvrsioci_pozvao_id_users_id_fk" FOREIGN KEY ("pozvao_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zadatak_opisi" ADD CONSTRAINT "zadatak_opisi_zadatak_id_zadaci_id_fk" FOREIGN KEY ("zadatak_id") REFERENCES "public"."zadaci"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zadatak_opisi" ADD CONSTRAINT "zadatak_opisi_autor_id_users_id_fk" FOREIGN KEY ("autor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "zadatak_izvrsilac_uniq" ON "zadatak_izvrsioci" USING btree ("zadatak_id","user_id");