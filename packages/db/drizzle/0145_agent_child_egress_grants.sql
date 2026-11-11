-- The owner's toggle that lets an Agent's sub-agents and Environments have network access wider than its own (#6413): a row means on. And how the owner answered the network rules that waited on a sub-agent, kept on its invocation for its driver to read.
CREATE TABLE "agent_child_egress_grants" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"granted_by" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invocations" ADD COLUMN "egress_answers" jsonb;
