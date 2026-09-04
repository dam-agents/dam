-- #3114: The Viewer Allowlist of a restricted artifact. One row per
-- (artifact, email). Emails are stored lowercased and trimmed; the api-server
-- normalises them before the write. Rows stay when the artifact goes back to
-- private and are only read while visibility is "restricted". Deleting the
-- artifact deletes its rows.
CREATE TABLE "library_artifact_viewers" (
	"artifact_id" text NOT NULL,
	"email" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_artifact_viewers_artifact_id_email_pk" PRIMARY KEY("artifact_id","email")
);
--> statement-breakpoint
ALTER TABLE "library_artifact_viewers" ADD CONSTRAINT "library_artifact_viewers_artifact_id_library_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."library_artifacts"("id") ON DELETE cascade ON UPDATE no action;