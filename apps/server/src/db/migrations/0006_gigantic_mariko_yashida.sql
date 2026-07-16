CREATE TABLE "report_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"doc_type" varchar(20) NOT NULL,
	"naziv" varchar(200) NOT NULL,
	"html" text DEFAULT '' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
