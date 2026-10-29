-- Each Agent's list of people moves from one jsonb array to a row per email.
-- The emails were stored trimmed and lowercased, so a duplicate is dropped.
-- An Environment its agent narrowed opens to the whole list now: its own
-- `access` held only emails already on the list, so nothing of it is copied.
INSERT INTO "agent_environment_members" ("owning_agent_id", "email", "added_at")
SELECT l."owning_agent_id", e.email, l."updated_at"
FROM "environment_access_lists" l
CROSS JOIN LATERAL jsonb_array_elements_text(l."emails") AS e(email)
ON CONFLICT DO NOTHING;
