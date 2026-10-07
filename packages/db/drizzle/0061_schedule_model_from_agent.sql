-- #4031: a Schedule with no model now runs on the harness's own default, where
-- it used to run on whatever model its Agent was set to. Each existing Schedule
-- keeps the model it runs on today: one whose Agent names a model in its last
-- known model settings gets that model, and one whose Agent names none already
-- runs on the default and is left alone.
UPDATE "schedules" AS s
SET "spec" = jsonb_set(s."spec", '{model}', a."harness_config_snapshot" -> 'model')
FROM "agents" AS a
WHERE a."id" = s."agent_id"
  AND NOT (s."spec" ? 'model')
  AND jsonb_typeof(a."harness_config_snapshot" -> 'model') = 'string'
  AND a."harness_config_snapshot" ->> 'model' <> '';
