-- The assistant each person is given: one row per owner, written before the
-- Agent is created and never rewritten by a request, so the create happens once.
-- `agent_id` names the ordinary Agent that is the assistant, and `state` says
-- whether that Agent is still being made (`creating`) or is there (`ready`) — a
-- reset that meets a create in flight adopts it instead of making a second one.
-- A person who deletes the Agent keeps the row, so nothing recreates it on a
-- request. `used_at` marks it as used once it has a Session that began after
-- `reset_at`, the moment of the person's last onboarding reset: a runtime that
-- boots re-reports the Sessions it already had, and those are not a new use.
-- The mark decides the first landing and the greeting without waking it.
CREATE TABLE "dambledore_provisioned" (
	"owner" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"state" text DEFAULT 'creating' NOT NULL,
	"used_at" timestamp with time zone,
	"reset_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "dambledore_provisioned_agent_idx" ON "dambledore_provisioned" USING btree ("agent_id");