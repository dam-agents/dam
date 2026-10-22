-- Claude Code decides its auto-mode permission checks server-side, on the model
-- call itself, and this proxy serves that. The flag the ETE LiteLLM preset used
-- to send turned that off and moved the classifier to a client-side prompt the
-- proxy's Sonnet model refuses, which denied tool calls that are safe. Drop it
-- from stored presets as well as new Connections, leaving credentials and grants
-- untouched, and re-deliver the changed provider env.
WITH updated AS (
  UPDATE connections c
  SET contributions = coalesce(
    (
      SELECT jsonb_agg(item ORDER BY position)
      FROM jsonb_array_elements(c.contributions) WITH ORDINALITY AS existing(item, position)
      WHERE (item ->> 'kind') IS DISTINCT FROM 'env'
        OR (item ->> 'name') IS DISTINCT FROM 'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS'
    ),
    '[]'::jsonb
  )
  WHERE c.template_id = 'ibm-litellm'
    AND c.contributions @> '[{"kind":"env","name":"CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS"}]'::jsonb
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
