-- An MCP Connection gets a tool mode of its own: allow all, read only or needs
-- approval. A Slack Account connection's choice between read only and "Can
-- post as me" was auth.fullAccess, and moves into the mode: one with
-- fullAccess allows all, one without it stays read only, so no agent gains or
-- loses a tool. The tool list stays empty until the api-server reads it from
-- the server. Only Slack's rows lose fullAccess: a GitHub connection uses the
-- same key for an unnarrowed connection, which this does not touch.
ALTER TABLE "connections" ADD COLUMN "tool_access" jsonb;--> statement-breakpoint
UPDATE connections
SET tool_access = jsonb_build_object(
      'mode', CASE WHEN auth ? 'fullAccess' THEN 'allow-all' ELSE 'read-only' END,
      'tools', NULL,
      'listedAt', NULL,
      'listError', NULL
    ),
    auth = auth - 'fullAccess',
    updated_at = now()
WHERE template_id = 'slack';
