CREATE TABLE "user_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"role_id" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_roles_idx" ON "user_roles" USING btree ("user_id","role_id");--> statement-breakpoint
INSERT INTO "roles" ("name") SELECT 'admin' WHERE NOT EXISTS (SELECT 1 FROM "roles" WHERE "name" = 'admin');--> statement-breakpoint
INSERT INTO "user_roles" ("user_id", "role_id") SELECT "id", "role_id" FROM "users" WHERE "role_id" IS NOT NULL;--> statement-breakpoint
INSERT INTO "user_roles" ("user_id", "role_id") SELECT u."id", r."id" FROM "users" u, "roles" r WHERE u."is_admin" = true AND r."name" = 'admin' ON CONFLICT DO NOTHING;