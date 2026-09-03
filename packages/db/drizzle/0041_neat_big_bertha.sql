-- Session type/mode projection for the Usage tab's spend-by-session-type
-- breakdown. Session metadata is agent-owned (it lives on the agent's PVC), so
-- it is unreadable while a pod hibernates and is destroyed with the agent —
-- while its spend survives in telemetry. This table is the one dimension the
-- read path needs, kept where a deleted agent's history stays queryable.
CREATE TABLE "agent_sessions" (
	"agent_id" text NOT NULL,
	"session_id" text NOT NULL,
	"mode" text NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_sessions_agent_id_session_id_pk" PRIMARY KEY("agent_id","session_id")
);
--> statement-breakpoint
CREATE INDEX "agent_sessions_created_idx" ON "agent_sessions" USING btree ("created_at");