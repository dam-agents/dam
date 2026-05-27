-- ADR-051 / ADR-052 / ADR-053: Connections + unified runtime channel + outbox.
--
-- Adds the durable surface for the unified Connection/Contribution model and
-- the runtime-channel delivery rail:
--   * `connections` + `connection_grants` — replaces the parallel OAuth-app
--     and provider-preset code-declared registries.
--   * `agents` — runtime-channel view of agents; capabilities reported on
--     `runtime.v1.hello`. K8s ConfigMap remains the source of truth for spec.
--   * `runtime_state_outbox` + `runtime_events` — one row per agent + one row
--     per pending event; the single per-agent monotonic `version` is the ack
--     cursor for the whole apply payload (state + events).
--
-- Pure-additive migration. No data movement; the cutover from pod-files SSE,
-- trigger-files exec, and direct skills RPC happens in application code.
--
-- Per-kind event work (e.g. `trigger`) runs agent-side — the agent's runtime
-- channel dispatches against its in-process ACP runtime. No per-event
-- side-effect table here.

CREATE TABLE "connections" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"template_id" text NOT NULL,
	"name" text NOT NULL,
	"inputs" jsonb NOT NULL,
	"auth" jsonb NOT NULL,
	"contributions" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connection_grants" (
	"connection_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connection_grants_connection_id_agent_id_pk" PRIMARY KEY ("connection_id","agent_id")
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "runtime_protocol_version" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "runtime_capabilities" jsonb;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "runtime_last_hello_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "runtime_agent_version" text;
--> statement-breakpoint
CREATE TABLE "runtime_state_outbox" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"version" bigint DEFAULT 0 NOT NULL,
	"last_enqueued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_applied_version" bigint DEFAULT 0 NOT NULL,
	"last_applied_hash" text,
	"last_applied_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "runtime_events" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"version" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"dispatched_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "connections_owner_idx" ON "connections" USING btree ("owner");--> statement-breakpoint
CREATE INDEX "connection_grants_agent_idx" ON "connection_grants" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "runtime_state_outbox_stale_idx" ON "runtime_state_outbox" USING btree ("last_enqueued_at") WHERE "runtime_state_outbox"."last_applied_at" IS NULL OR "runtime_state_outbox"."last_enqueued_at" > "runtime_state_outbox"."last_applied_at";--> statement-breakpoint
CREATE INDEX "runtime_events_agent_pending_idx" ON "runtime_events" USING btree ("agent_id","version") WHERE "runtime_events"."dispatched_at" IS NULL;--> statement-breakpoint
CREATE INDEX "runtime_events_expiry_idx" ON "runtime_events" USING btree ("expires_at") WHERE "runtime_events"."dispatched_at" IS NULL;
