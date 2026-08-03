-- Artifact library (#2810) + per-user experimental feature flags, squashed
-- into one migration before merge (replaces the PR-local 0013–0016 chain;
-- the journal `when` is kept at the old chain's last value so dev databases
-- that already ran it skip this file). Artifacts/folders/versions carry real
-- FKs (versions cascade with their artifact, folder deletion ungroups via
-- SET NULL); owner/agent references leave Postgres and stay plain strings.
-- There are deliberately no password columns — the unguessable share slug is
-- the entire public access control. The partial index on expires_at backs
-- the expiry sweeper's scan. user_features stores only explicit toggles;
-- every feature defaults off.
CREATE TABLE "artifact_folders" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_artifact_versions" (
	"artifact_id" text NOT NULL,
	"version" integer NOT NULL,
	"storage_ref" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_artifact_versions_artifact_id_version_pk" PRIMARY KEY("artifact_id","version")
);
--> statement-breakpoint
CREATE TABLE "library_artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"agent_id" text,
	"folder_id" text,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"kind" text NOT NULL,
	"content_type" text NOT NULL,
	"file_name" text NOT NULL,
	"storage_ref" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"expires_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_features" (
	"owner" text NOT NULL,
	"feature" text NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_features_owner_feature_pk" PRIMARY KEY("owner","feature")
);
--> statement-breakpoint
ALTER TABLE "library_artifact_versions" ADD CONSTRAINT "library_artifact_versions_artifact_id_library_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."library_artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_artifacts" ADD CONSTRAINT "library_artifacts_folder_id_artifact_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."artifact_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifact_folders_owner_idx" ON "artifact_folders" USING btree ("owner");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_folders_slug_unique_idx" ON "artifact_folders" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_folders_owner_name_unique_idx" ON "artifact_folders" USING btree ("owner","name");--> statement-breakpoint
CREATE INDEX "library_artifacts_owner_idx" ON "library_artifacts" USING btree ("owner");--> statement-breakpoint
CREATE UNIQUE INDEX "library_artifacts_slug_unique_idx" ON "library_artifacts" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "library_artifacts_folder_idx" ON "library_artifacts" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "library_artifacts_agent_idx" ON "library_artifacts" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "library_artifacts_expires_idx" ON "library_artifacts" USING btree ("expires_at") WHERE "library_artifacts"."expires_at" is not null;