-- The assistant each person is given (#3587, D195): one row per owner and the
-- durable record of provisioning it, written BEFORE the Agent is created. The
-- pre-chosen `agent_id` is the provisioning identity, so a retry after a crash,
-- a failed create or a deleted Agent creates that same Agent again instead of a
-- second one, and a create that loses a race adopts the winner's. `state` says
-- whether that Agent is being made (`creating`), is there (`ready`) or was
-- deleted (`gone`). `used_at` marks the assistant as used once it has a session,
-- which is what decides the first landing without waking it. The `renamed_*`
-- columns are the one-time news that an Agent the owner already had was renamed
-- to free the reserved name, recorded before the rename so a failure cannot lose
-- it; `notice_seen_at` says when they dismissed it.
CREATE TABLE "assistants" (
	"owner" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"state" text DEFAULT 'creating' NOT NULL,
	"used_at" timestamp with time zone,
	"renamed_agent_id" text,
	"renamed_from" text,
	"renamed_to" text,
	"notice_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
