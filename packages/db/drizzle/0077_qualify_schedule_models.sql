-- Sessions, schedules and the saved default pair now name a model with its
-- provider (`<alias>/<upstream id>`), the alias fixed per provider preset.
-- Stored bare names are qualified only where that is unambiguous: a schedule's
-- model takes the alias of the one provider Connection its agent holds; the
-- saved pair's model takes the alias of the Connection the pair names. Every
-- other bare schedule model is cleared and the schedule carries a note until
-- its owner picks a model again. Claude Code's own spelling (`claude/<id>`,
-- lowercased) is folded before qualifying. Dry run (counts per outcome) before
-- applying, with the api-server's psql:
--   WITH p AS (SELECT g.agent_id, count(DISTINCT c.template_id) n
--              FROM connection_grants g JOIN connections c ON c.id = g.connection_id
--              WHERE c.template_id IN ('ibm-litellm','curve-bender','anthropic','anthropic-oauth','openai','bedrock','bob')
--              GROUP BY g.agent_id)
--   SELECT CASE WHEN p.n = 1 THEN 'qualify' ELSE 'clear' END AS outcome, count(*)
--   FROM schedules s LEFT JOIN p ON p.agent_id = s.agent_id
--   WHERE s.spec ? 'model'
--     AND split_part(regexp_replace(s.spec->>'model', '^claude/', ''), '/', 1)
--         NOT IN ('ibm','cb','anthropic','openai','bedrock','bob')
--   GROUP BY 1;
WITH alias_of AS (
  SELECT g.agent_id,
         c.id AS connection_id,
         CASE c.template_id
           WHEN 'ibm-litellm' THEN 'ibm'
           WHEN 'curve-bender' THEN 'cb'
           WHEN 'anthropic' THEN 'anthropic'
           WHEN 'anthropic-oauth' THEN 'anthropic'
           WHEN 'openai' THEN 'openai'
           WHEN 'bedrock' THEN 'bedrock'
           WHEN 'bob' THEN 'bob'
         END AS alias
  FROM connection_grants g
  JOIN connections c ON c.id = g.connection_id
  WHERE c.template_id IN ('ibm-litellm', 'curve-bender', 'anthropic', 'anthropic-oauth', 'openai', 'bedrock', 'bob')
),
per_agent AS (
  SELECT agent_id, count(DISTINCT alias) AS n, min(alias) AS alias
  FROM alias_of
  GROUP BY agent_id
),
bare AS (
  SELECT s.id,
         regexp_replace(s.spec->>'model', '^claude/', '') AS model,
         p.n,
         p.alias
  FROM schedules s
  LEFT JOIN per_agent p ON p.agent_id = s.agent_id
  WHERE s.spec ? 'model'
    AND split_part(regexp_replace(s.spec->>'model', '^claude/', ''), '/', 1)
        NOT IN ('ibm', 'cb', 'anthropic', 'openai', 'bedrock', 'bob')
)
UPDATE schedules s
SET spec = CASE
             WHEN b.n = 1 THEN jsonb_set(s.spec, '{model}', to_jsonb(b.alias || '/' || b.model))
             ELSE (s.spec - 'model') || '{"migrationNote": "model cleared: the old name named no provider and the agent holds none or several"}'::jsonb
           END,
    updated_at = now()
FROM bare b
WHERE b.id = s.id;
--> statement-breakpoint
WITH alias_of AS (
  SELECT c.id AS connection_id,
         CASE c.template_id
           WHEN 'ibm-litellm' THEN 'ibm'
           WHEN 'curve-bender' THEN 'cb'
           WHEN 'anthropic' THEN 'anthropic'
           WHEN 'anthropic-oauth' THEN 'anthropic'
           WHEN 'openai' THEN 'openai'
           WHEN 'bedrock' THEN 'bedrock'
           WHEN 'bob' THEN 'bob'
         END AS alias
  FROM connections c
  WHERE c.template_id IN ('ibm-litellm', 'curve-bender', 'anthropic', 'anthropic-oauth', 'openai', 'bedrock', 'bob')
),
pairs AS (
  SELECT a.id,
         regexp_replace(a.session_pair->>'model', '^claude/', '') AS model,
         al.alias
  FROM agents a
  LEFT JOIN alias_of al ON al.connection_id = a.session_pair->>'provider'
  WHERE a.session_pair ? 'model'
    AND a.session_pair->>'model' IS NOT NULL
    AND split_part(regexp_replace(a.session_pair->>'model', '^claude/', ''), '/', 1)
        NOT IN ('ibm', 'cb', 'anthropic', 'openai', 'bedrock', 'bob')
)
UPDATE agents a
SET session_pair = CASE
                     WHEN p.alias IS NOT NULL THEN jsonb_set(a.session_pair, '{model}', to_jsonb(p.alias || '/' || p.model))
                     ELSE jsonb_set(a.session_pair, '{model}', 'null'::jsonb)
                   END
FROM pairs p
WHERE p.id = a.id;
