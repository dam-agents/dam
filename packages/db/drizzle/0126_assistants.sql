-- The assistant each person is given (#3587, D195): one row per owner, written
-- when the api-server provisions its Agent, which is what keeps it one per
-- owner. `agent_id` is null when that Agent is gone, so the next sign-in makes
-- one again. The `renamed_*` columns carry the one-time news that an Agent the
-- owner already had was renamed to free the reserved name, and `notice_seen_at`
-- says when they dismissed it.
CREATE TABLE "assistants" (
	"owner" text PRIMARY KEY NOT NULL,
	"agent_id" text,
	"renamed_agent_id" text,
	"renamed_from" text,
	"renamed_to" text,
	"notice_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
