-- #3023: picking skills was per-sandbox work redone from memory on every new
-- one. A skill set is a reusable, per-user selection: `(gitUrl, name)` pairs so
-- it survives its source row being deleted and re-added, and no version so an
-- apply resolves against whatever the source serves today.

CREATE TABLE "skill_sets" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"skills" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "skill_sets_owner_name_idx" ON "skill_sets" USING btree ("owner","name");--> statement-breakpoint
CREATE INDEX "skill_sets_owner_idx" ON "skill_sets" USING btree ("owner");