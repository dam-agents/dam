-- Tool access moves from the MCP Connection to the grant: one Agent on one
-- Connection gets its own rule per tool (allow, ask, block). No backfill: a
-- grant with no value follows its Connection's tool mode, so no Agent gains or
-- loses a tool. The trigger connection_grants_bump_generation fires only on
-- connection_id and agent_id, so a write of this column does not bump the
-- Agent's generation: the gate reads it on every request, and the gateway
-- needs no new render.
ALTER TABLE "connection_grants" ADD COLUMN "tool_access" jsonb;
