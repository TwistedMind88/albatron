CREATE TABLE "uputstva_dokumenti" (
	"id" serial PRIMARY KEY NOT NULL,
	"naziv" varchar(200) NOT NULL,
	"filename" varchar(300) NOT NULL,
	"stored_path" varchar(500) NOT NULL,
	"sistemsko" boolean DEFAULT false NOT NULL
);
