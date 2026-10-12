-- CurveBender's Sonnet slot serves the non-reasoning permission classifier,
-- not normal work. Update stored presets as well as new Connections, leaving
-- credentials and grants untouched, and re-deliver the changed provider env.
WITH defaults AS (
  SELECT '[
    {"kind":"env","name":"ANTHROPIC_MODEL","placeholder":"rits/zai-org/glm-5-3"},
    {"kind":"env","name":"ANTHROPIC_DEFAULT_MODEL","placeholder":"rits/zai-org/glm-5-3"},
    {"kind":"env","name":"ANTHROPIC_DEFAULT_FABLE_MODEL","placeholder":"rits/zai-org/glm-5-3"},
    {"kind":"env","name":"ANTHROPIC_DEFAULT_OPUS_MODEL","placeholder":"rits/zai-org/glm-5-3"},
    {"kind":"env","name":"ANTHROPIC_DEFAULT_HAIKU_MODEL","placeholder":"rits/zai-org/glm-5-3"},
    {"kind":"env","name":"ANTHROPIC_DEFAULT_SONNET_MODEL","placeholder":"rits/nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-NVFP4"},
    {"kind":"env","name":"CLAUDE_CODE_AUTO_MODE_SERVER","placeholder":"0"},
    {"kind":"env","name":"ENABLE_TOOL_SEARCH","placeholder":"false"},
    {"kind":"env","name":"CLAUDE_CODE_MAX_CONTEXT_TOKENS","placeholder":"256000"},
    {"kind":"env","name":"OPENAI_PROXY_CONTEXT_WINDOW","placeholder":"256000"}
  ]'::jsonb AS contributions
), updated AS (
  UPDATE connections c
  SET contributions = (
    SELECT coalesce(jsonb_agg(item ORDER BY position), '[]'::jsonb)
    FROM jsonb_array_elements(c.contributions) WITH ORDINALITY AS existing(item, position)
    WHERE item ->> 'kind' IS DISTINCT FROM 'env'
      OR NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(d.contributions) AS replacement
        WHERE replacement ->> 'name' = item ->> 'name'
      )
  ) || d.contributions
  FROM defaults d
  WHERE c.template_id = 'curve-bender'
  RETURNING c.id
)
UPDATE runtime_state_outbox o
SET version = o.version + 1,
    last_enqueued_at = now()
WHERE EXISTS (
  SELECT 1 FROM connection_grants g
  JOIN updated c ON c.id = g.connection_id
  WHERE g.agent_id = o.agent_id
);
