-- #3291: One row per shared knowledge base. Holds the durable share secret
-- (stored retrievably so the owner can re-copy the same share string — a
-- deliberate departure from the api_keys HMAC-only model), the owner-controlled
-- public_name shown to consumers, the published snapshot pointer + stats, and
-- the publish lifecycle: publish_token fences a completing publish against
-- unrelated writers, stale_snapshots defers deleting a swapped-out snapshot a
-- consumer may still be reading, and dirty_at drives debounced auto-refresh
-- that survives an api-server restart.
CREATE TABLE "kb_shares" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"owner" text NOT NULL,
	"secret" text NOT NULL,
	"public_name" text,
	"roots" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"snapshot_id" text,
	"snapshot_manifest_key" text,
	"snapshot_created_at" timestamp with time zone,
	"document_count" integer,
	"total_size_bytes" bigint,
	"publish_state" text DEFAULT 'idle' NOT NULL,
	"publish_error" text,
	"publish_token" text,
	"stale_snapshots" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"query_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"dirty_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "kb_shares_active_agent_idx" ON "kb_shares" USING btree ("agent_id") WHERE "kb_shares"."status" = 'active';--> statement-breakpoint
CREATE INDEX "kb_shares_owner_idx" ON "kb_shares" USING btree ("owner");