-- CurveBender's preset changed twice: its work model is DeepSeek V4.1 Flash
-- now, and the RITS deployment behind it serves a 1M window (max_model_len
-- 1048576, measured), not the 256k the preset was written for while it ran
-- GLM. A stored Connection keeps the env it was created with, and this one
-- reaches the model catalog, Codex, Pi and Bob directly, so it is rebuilt
-- from the preset as it stands: every `env` contribution is replaced, since
-- the preset is the only writer of a preset Connection's env, and the rest of
-- the contributions and the credentials are left alone. No slot is singled
-- out: whichever model is right for a slot is the model router's call, not
-- this stored env's.
--
-- The affected agents' provider env is re-delivered so their catalog and
-- their next harness process see the new window and model.
WITH defaults AS (
  SELECT '[
    {"kind":"env","name":"ANTHROPIC_AUTH_TOKEN","placeholder":"sk-dummy-placeholder"},
    {"kind":"env","name":"ANTHROPIC_BASE_URL","placeholder":"https://litellm.cb.ete.res.ibm.com"},
    {"kind":"env","name":"OPENAI_PROXY_URL","placeholder":"https://litellm.cb.ete.res.ibm.com"},
    {"kind":"env","name":"OPENAI_PROXY_MODEL","placeholder":"rits/deepseek-ai/DeepSeek-V4.1-Flash-1017"},
    {"kind":"env","name":"OPENAI_PROXY_CONTEXT_WINDOW","placeholder":"1048576"},
    {"kind":"env","name":"OPENAI_PROXY_MAX_TOKENS","placeholder":"32768"},
    {"kind":"env","name":"OPENAI_PROXY_REASONING","placeholder":"1"},
    {"kind":"env","name":"OPENAI_API_KEY","placeholder":"dummy-placeholder"},
    {"kind":"env","name":"OPENAI_BASE_URL","placeholder":"https://litellm.cb.ete.res.ibm.com"},
    {"kind":"env","name":"OPENAI_MODEL","placeholder":"rits/deepseek-ai/DeepSeek-V4.1-Flash-1017"},
    {"kind":"env","name":"BOB_GATEWAY_URL","placeholder":"https://litellm.cb.ete.res.ibm.com"},
    {"kind":"env","name":"BOBSHELL_API_KEY","placeholder":"dummy-placeholder"},
    {"kind":"env","name":"BOB_SHELL_MODEL","placeholder":"rits/deepseek-ai/DeepSeek-V4.1-Flash-1017"},
    {"kind":"env","name":"ANTHROPIC_MODEL","placeholder":"rits/deepseek-ai/DeepSeek-V4.1-Flash-1017"},
    {"kind":"env","name":"ANTHROPIC_DEFAULT_MODEL","placeholder":"rits/deepseek-ai/DeepSeek-V4.1-Flash-1017"},
    {"kind":"env","name":"ANTHROPIC_DEFAULT_FABLE_MODEL","placeholder":"rits/deepseek-ai/DeepSeek-V4.1-Flash-1017"},
    {"kind":"env","name":"ANTHROPIC_DEFAULT_OPUS_MODEL","placeholder":"rits/deepseek-ai/DeepSeek-V4.1-Flash-1017"},
    {"kind":"env","name":"ANTHROPIC_DEFAULT_SONNET_MODEL","placeholder":"rits/deepseek-ai/DeepSeek-V4.1-Flash-1017"},
    {"kind":"env","name":"ANTHROPIC_DEFAULT_HAIKU_MODEL","placeholder":"rits/deepseek-ai/DeepSeek-V4.1-Flash-1017"},
    {"kind":"env","name":"CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS","placeholder":"1"},
    {"kind":"env","name":"CLAUDE_CODE_AUTO_MODE_SERVER","placeholder":"0"},
    {"kind":"env","name":"ENABLE_TOOL_SEARCH","placeholder":"false"},
    {"kind":"env","name":"CLAUDE_CODE_MAX_CONTEXT_TOKENS","placeholder":"1048576"}
  ]'::jsonb AS contributions
), updated AS (
  UPDATE connections c
  SET contributions = (
    SELECT coalesce(jsonb_agg(item ORDER BY position), '[]'::jsonb)
    FROM jsonb_array_elements(c.contributions) WITH ORDINALITY
      AS existing(item, position)
    WHERE item ->> 'kind' IS DISTINCT FROM 'env'
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
