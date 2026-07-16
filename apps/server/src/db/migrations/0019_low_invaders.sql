CREATE TABLE "uplate" (
	"id" serial PRIMARY KEY NOT NULL,
	"klijent_id" integer NOT NULL,
	"iznos" numeric(14, 2) NOT NULL,
	"poziv_na_broj" varchar(50) NOT NULL,
	"datum_uplate" date NOT NULL,
	"referent" varchar(100) DEFAULT '' NOT NULL,
	"avans" boolean DEFAULT false NOT NULL,
	"napomena" varchar(100) DEFAULT '' NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "uplate" ADD CONSTRAINT "uplate_klijent_id_subjects_id_fk" FOREIGN KEY ("klijent_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uplate" ADD CONSTRAINT "uplate_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;