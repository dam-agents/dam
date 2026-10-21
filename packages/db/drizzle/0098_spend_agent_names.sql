-- A spend ledger row outlives its agent; this keeps the name the agent's
-- resource had when it went, so the spend screens can still name it.
CREATE TABLE "spend_agent_names" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"owner_sub" text NOT NULL,
	"name" text NOT NULL,
	"removed_at" timestamp with time zone NOT NULL
);
