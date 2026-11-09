-- The assistant each person is given: one row per owner, written before the
-- Agent is created and never rewritten by a request, so the create happens once.
-- `agent_id` names the ordinary Agent that is the assistant; a person who deletes
-- it keeps the row, so nothing recreates it on a request. `used_at` marks it as
-- used once it has a Session, which is what decides the first landing and the
-- greeting without waking it; resetting a person's onboarding clears it, and
-- creates the Agent again when that one is gone.
CREATE TABLE "dambledore_provisioned" (
	"owner" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
