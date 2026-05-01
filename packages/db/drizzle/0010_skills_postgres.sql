CREATE TABLE "skill_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"git_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "skill_sources_owner_git_url_idx" ON "skill_sources" USING btree ("owner","git_url");--> statement-breakpoint
CREATE INDEX "skill_sources_owner_idx" ON "skill_sources" USING btree ("owner");--> statement-breakpoint
CREATE TABLE "instance_skills" (
	"instance_id" text NOT NULL,
	"source" text NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"content_hash" text,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instance_skills_pkey" PRIMARY KEY("instance_id","source","name")
);
--> statement-breakpoint
CREATE INDEX "instance_skills_instance_idx" ON "instance_skills" USING btree ("instance_id");--> statement-breakpoint
CREATE TABLE "instance_skill_publishes" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"skill_name" text NOT NULL,
	"source_id" text NOT NULL,
	"source_name" text NOT NULL,
	"source_git_url" text NOT NULL,
	"pr_url" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "instance_skill_publishes_instance_idx" ON "instance_skill_publishes" USING btree ("instance_id");
