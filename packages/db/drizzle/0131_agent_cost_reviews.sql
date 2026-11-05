-- The owner's answer to the platform's offer of a cost review for an Agent:
-- accepted, which is final, or Later, which hides the offer for a while.
CREATE TABLE "agent_cost_reviews" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"decision" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
