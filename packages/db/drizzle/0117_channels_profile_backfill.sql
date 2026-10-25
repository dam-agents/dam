-- A channel that predates profiles inherited the agent's chat default because
-- it had none of its own. Now that a channel runs on its own profile (D91), the
-- inherited ones are pinned to the chat profile they were following, so an
-- upgraded install keeps every channel on the values it had; a channel whose
-- agent held an inline chat pair, or its own legacy channel pair, is left null
-- and keeps the fallback chain it already had.
UPDATE "channels" c
SET "profile_id" = a."session_profile"
FROM "agents" a
WHERE c."agent_id" = a."id"
  AND c."profile_id" IS NULL
  AND a."channel_session_pair" IS NULL
  AND a."session_profile" IS NOT NULL;
