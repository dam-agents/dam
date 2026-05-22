-- ADR-048 / ADR-049: Postgres-backed outbox for the unified runtime
-- channel. State delivery is snapshot-shaped (one row per agent, last-
-- write-wins); signals are event-shaped (one row per discrete event,
-- with TTL). The BullMQ worker reads these tables after the mutation
-- transaction commits; the cron sweep re-enqueues anything Redis lost.

CREATE TABLE IF NOT EXISTS "runtime_state_outbox" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"enqueued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_applied_hash" text,
	"last_applied_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "runtime_signal_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"action" text NOT NULL,
	"payload" jsonb NOT NULL,
	"enqueued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runtime_signal_outbox_agent_idx" ON "runtime_signal_outbox" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runtime_signal_outbox_expires_idx" ON "runtime_signal_outbox" USING btree ("expires_at");
