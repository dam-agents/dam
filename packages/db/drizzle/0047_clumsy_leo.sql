-- Multi-node: `nodes` is the registry each api-server heartbeats into, and
-- `agent_records.assigned_node` records which node is running an agent so a
-- node's supervisor reconciles only its own. `secrets` moves credential bytes
-- off the node's filesystem, since the node that injects a credential is not
-- necessarily the one the agent was created on. `last_node` remembers the
-- previous placement so a wake can prefer the node that still has the disk.
CREATE TABLE "nodes" (
	"id" text PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"capacity_cpu_milli" integer NOT NULL,
	"capacity_memory_bytes" bigint NOT NULL,
	"state" text DEFAULT 'ready' NOT NULL,
	"last_heartbeat" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secrets" (
	"store_id" text NOT NULL,
	"path" text NOT NULL,
	"owner" text NOT NULL,
	"purpose" text NOT NULL,
	"metadata" jsonb NOT NULL,
	"fields" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "secrets_store_id_path_pk" PRIMARY KEY("store_id","path")
);
--> statement-breakpoint
ALTER TABLE "agent_records" ADD COLUMN "assigned_node" text;--> statement-breakpoint
ALTER TABLE "agent_records" ADD COLUMN "last_node" text;--> statement-breakpoint
CREATE INDEX "secrets_owner_idx" ON "secrets" USING btree ("owner","purpose");--> statement-breakpoint
CREATE INDEX "agent_records_assigned_node_idx" ON "agent_records" USING btree ("assigned_node");