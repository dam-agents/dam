-- The note about an untagged Slack reply becomes a lesson for new users only,
-- so it needs a record per person that survives restarts and deploys.
CREATE TABLE "slack_untagged_reply_notes" (
	"actor_hash" text PRIMARY KEY NOT NULL,
	"first_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_noted_at" timestamp with time zone,
	"graduated_at" timestamp with time zone
);
