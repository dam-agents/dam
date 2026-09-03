-- #3286: agent case-study editions — one row per (agent, week), the week keyed
-- by its Monday so a resubmission replaces that week's edition instead of
-- landing beside it. Submitted by the agent-case-study skill as status
-- 'pending' (owner-only) and released by the owner before inspectors or
-- processing can read it. Content is the sanitized one-page markdown itself:
-- small, bounded, and queryable, so retention and withdrawal are row deletes
-- with no blob side to orphan.
CREATE TABLE "agent_case_studies" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"edition_week_start" date NOT NULL,
	"window_start" text NOT NULL,
	"window_end" text NOT NULL,
	"content" text NOT NULL,
	"harness_image" text,
	"artifact_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_case_studies_agent_week_start_idx" ON "agent_case_studies" USING btree ("agent_id","edition_week_start");--> statement-breakpoint
CREATE INDEX "agent_case_studies_status_created_idx" ON "agent_case_studies" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "agent_case_studies_deleted_idx" ON "agent_case_studies" USING btree ("deleted_at") WHERE "agent_case_studies"."deleted_at" IS NOT NULL;