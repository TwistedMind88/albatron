CREATE TABLE "contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"subject_id" integer NOT NULL,
	"name" varchar(200) NOT NULL,
	"phone" varchar(60) DEFAULT '' NOT NULL,
	"email" varchar(200) DEFAULT '' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" serial PRIMARY KEY NOT NULL,
	"role" varchar(20) NOT NULL,
	"naziv" varchar(200) NOT NULL,
	"puni_naziv" varchar(400) NOT NULL,
	"adresa" varchar(300) NOT NULL,
	"postanski_broj" varchar(20) NOT NULL,
	"grad" varchar(100) NOT NULL,
	"pib" varchar(30) DEFAULT '' NOT NULL,
	"mb" varchar(30) DEFAULT '' NOT NULL,
	"drzava" varchar(100) DEFAULT 'Srbija' NOT NULL,
	"nacin_placanja_id" integer,
	"paritet_id" integer,
	"valuta" varchar(10) DEFAULT 'RSD' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_nacin_placanja_id_lookups_id_fk" FOREIGN KEY ("nacin_placanja_id") REFERENCES "public"."lookups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_paritet_id_lookups_id_fk" FOREIGN KEY ("paritet_id") REFERENCES "public"."lookups"("id") ON DELETE no action ON UPDATE no action;