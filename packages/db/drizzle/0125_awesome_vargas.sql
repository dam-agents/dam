-- An MCP tool's images ride the Job row beside its text output, because the
-- outcome is read back long after the worker that reported it is gone. Text
-- over the inline limit is spilled to a file; an image cannot be, so it is
-- stored as the base64 block the Agent's harness receives.
ALTER TABLE "satellite_jobs" ADD COLUMN "images" jsonb;
