CREATE TABLE "report_images" (
	"id" serial PRIMARY KEY NOT NULL,
	"naziv" varchar(100) NOT NULL,
	"filename" varchar(300) NOT NULL,
	"stored_path" varchar(500) NOT NULL,
	"mime" varchar(100) NOT NULL,
	CONSTRAINT "report_images_naziv_unique" UNIQUE("naziv")
);
--> statement-breakpoint
CREATE TABLE "report_table_defs" (
	"id" serial PRIMARY KEY NOT NULL,
	"naziv" varchar(100) NOT NULL,
	"doc_type" varchar(20),
	"kolone" jsonb NOT NULL,
	CONSTRAINT "report_table_defs_naziv_unique" UNIQUE("naziv")
);
