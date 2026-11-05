-- The assistant each person is given (#3587, D195): one row per owner and the
-- durable record of provisioning it, written before the Agent exists.
-- `incarnation` and the owner derive the Agent's id, so every replica computes
-- the same id and the store's create is the mutex: a second create is refused
-- by the primary key and adopts what is there. `state` says whether that Agent
-- is initialized (`ready`) or still has steps to run (`creating`), and `gone`
-- says its Agent was deleted, which bumps `incarnation` so the replacement gets
-- a new id — nothing keyed by the old one can then reach it. `init_steps` names
-- the initialization steps that have landed, recorded as each one does: a retry
-- applies only the rest, so nothing the owner revoked since is restored.
-- `used_at` marks the assistant as used once it has a session, which is what
-- decides the first landing without waking it. The `renamed_*` columns are the
-- one-time news that an Agent the owner already had was renamed to free the
-- reserved name, recorded before the rename and completed when it lands;
-- `notice_seen_at` says when they dismissed it.
CREATE TABLE "assistants" (
	"owner" text PRIMARY KEY NOT NULL,
	"incarnation" integer DEFAULT 1 NOT NULL,
	"agent_id" text NOT NULL,
	"state" text DEFAULT 'creating' NOT NULL,
	"init_steps" text[] DEFAULT '{}' NOT NULL,
	"used_at" timestamp with time zone,
	"renamed_agent_id" text,
	"renamed_from" text,
	"renamed_to" text,
	"renamed_done_at" timestamp with time zone,
	"notice_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
