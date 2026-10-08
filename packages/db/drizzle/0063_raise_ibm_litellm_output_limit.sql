-- A Connection stores its contributions when it is created, so the IBM LiteLLM
-- template's higher output limit reaches only new Connections. This raises
-- OPENAI_PROXY_MAX_TOKENS from 8192 to 32768 on every IBM LiteLLM Connection
-- that still holds the old value, keeping the order of its contributions, and
-- moves the desired runtime state of each Agent granted one: delivery runs only
-- when that version moves, so a running Agent would otherwise keep 8192.
WITH raised AS (
  UPDATE connections c
  SET contributions = (
        SELECT jsonb_agg(
                 CASE
                   WHEN e.item ->> 'kind' = 'env'
                    AND e.item ->> 'name' = 'OPENAI_PROXY_MAX_TOKENS'
                    AND e.item ->> 'placeholder' = '8192'
                   THEN jsonb_set(e.item, '{placeholder}', '"32768"')
                   ELSE e.item
                 END
                 ORDER BY e.ord
               )
        FROM jsonb_array_elements(c.contributions) WITH ORDINALITY AS e(item, ord)
      ),
      updated_at = now()
  WHERE c.template_id = 'ibm-litellm'
    AND c.contributions @> '[{"kind": "env", "name": "OPENAI_PROXY_MAX_TOKENS", "placeholder": "8192"}]'
  RETURNING c.id
)
UPDATE runtime_state_outbox o
SET version = o.version + 1,
    last_enqueued_at = now()
WHERE EXISTS (
  SELECT 1
  FROM connection_grants g
  JOIN raised r ON r.id = g.connection_id
  WHERE g.agent_id = o.agent_id
);
