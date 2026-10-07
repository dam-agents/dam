-- #4031: a Schedule with no model now runs on the harness's own default, where
-- it used to run on whatever model its Agent was set to. That changes only on
-- a harness that can switch one session's model, which today is Claude Code,
-- so each existing Schedule there keeps the model it runs on today: one whose
-- Agent names a model in its last known model settings gets that model, and
-- one whose Agent names none already runs on the default and is left alone.
-- An Agent still on an image that predates the sessionModel capability is
-- recognised by Claude Code's model catalog, whose haiku tier no other harness
-- lists. A one-time task that continues its scheduling session keeps that
-- session's model and takes none.
UPDATE "schedules" AS s
SET "spec" = jsonb_set(s."spec", '{model}', a."harness_config_snapshot" -> 'model')
FROM "agents" AS a
WHERE a."id" = s."agent_id"
  AND NOT (s."spec" ? 'model')
  AND coalesce(s."spec" -> 'origin' ->> 'mode', '') <> 'continue'
  AND jsonb_typeof(a."harness_config_snapshot" -> 'model') = 'string'
  AND a."harness_config_snapshot" ->> 'model' <> ''
  AND (
    a."runtime_capabilities" -> 'sessionModel' = 'true'::jsonb
    OR a."runtime_capabilities" -> 'harnessConfigCatalog' -> 'options'
      @> '[{"id": "model", "choices": [{"value": "haiku"}]}]'::jsonb
  );
