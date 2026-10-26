-- A GitHub sign-in made through the GitHub App, and a GitHub App installation,
-- each split into a parent that holds the credential (the sign-in's user and
-- refresh tokens, or the installation's private key) and the connections made
-- from it, each with its own scope and token. Names stay unique per owner among
-- parents and among the other connections, so a parent may share its name with
-- its first connection; removing a parent removes every connection made from it.
DROP INDEX "connections_owner_name_unique_idx";--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "parent_id" text;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "is_parent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_parent_id_connections_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connections_parent_idx" ON "connections" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connections_owner_name_unique_idx" ON "connections" USING btree ("owner","name","is_parent");--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_parent_has_no_parent" CHECK (NOT ("connections"."is_parent" AND "connections"."parent_id" IS NOT NULL));