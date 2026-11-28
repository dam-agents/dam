-- A grant of a GitHub or platform Connection can carry the Agent's own scope,
-- and the key of the derived credential of the Connection that matches it.
-- The derived credential's value lives in its own Secret and is recorded with
-- its Connection. No backfill: a grant with no scope uses its Connection's own
-- credential, as before. MCP tool access keeps its own column.
ALTER TABLE "connection_grants" ADD COLUMN "scope" jsonb;--> statement-breakpoint
ALTER TABLE "connection_grants" ADD COLUMN "derived_key" text;