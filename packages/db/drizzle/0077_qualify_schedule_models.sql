-- Sessions, schedules and the saved default pair now name a model with its
-- provider (`<alias>/<upstream id>`), the alias fixed per provider preset.
-- Stored bare names are qualified only where that is unambiguous: a schedule's
-- model takes the alias of the one provider Connection its agent holds; the
-- saved pair's model takes the alias of the Connection the pair names, or of
-- the one provider Connection the agent holds when the pair names none.
-- Claude Code's tier names (haiku, opus, sonnet, fable) are no provider's
-- models: on Bedrock, the one provider Claude Code runs natively, they stay
-- its own names (`bedrock/haiku`); anywhere else a tier name is cleared, so
-- the schedule carries a note until its owner picks a model again and the
-- pair falls back to its provider's default. `default` means the harness's
-- default and is dropped. Every other bare schedule model is cleared and the
-- schedule carries a note. Claude Code's own spelling (`claude/<id>`,
-- lowercased) is folded before qualifying. A row already qualified as
-- `<alias>/<tier>` on a provider other than Bedrock is repaired the same way.
-- Dry runs (counts per outcome) before applying, with the api-server's psql:
--   WITH p AS (SELECT g.agent_id, count(DISTINCT CASE c.template_id
--                WHEN 'ibm-litellm' THEN 'ibm' WHEN 'curve-bender' THEN 'cb'
--                WHEN 'anthropic' THEN 'anthropic' WHEN 'anthropic-oauth' THEN 'anthropic'
--                WHEN 'openai' THEN 'openai' WHEN 'bedrock' THEN 'bedrock' WHEN 'bob' THEN 'bob' END) n,
--              min(CASE c.template_id WHEN 'bedrock' THEN 'bedrock' END) bedrock
--              FROM connection_grants g JOIN connections c ON c.id = g.connection_id
--              WHERE c.template_id IN ('ibm-litellm','curve-bender','anthropic','anthropic-oauth','openai','bedrock','bob')
--              GROUP BY g.agent_id),
--        m AS (SELECT s.id, s.agent_id,
--              regexp_replace(regexp_replace(s.spec->>'model', '^claude/', ''), '^(ibm|cb|anthropic|openai|bob|bedrock)/', '') AS stripped,
--              split_part(regexp_replace(s.spec->>'model', '^claude/', ''), '/', 1) AS head
--              FROM schedules s WHERE s.spec ? 'model')
--   SELECT CASE
--            WHEN lower(regexp_replace(m.stripped, '\[1m\]$', '')) = 'default' THEN 'drop default'
--            WHEN lower(regexp_replace(m.stripped, '\[1m\]$', '')) IN ('haiku','opus','sonnet','fable')
--                 THEN CASE WHEN m.head = 'bedrock' THEN 'keep bedrock tier'
--                           WHEN p.n = 1 AND p.bedrock IS NOT NULL THEN 'qualify bedrock tier'
--                           ELSE 'clear tier' END
--            WHEN m.head IN ('ibm','cb','anthropic','openai','bedrock','bob') THEN 'keep'
--            WHEN p.n = 1 THEN 'qualify' ELSE 'clear' END AS outcome, count(*)
--   FROM m LEFT JOIN p ON p.agent_id = m.agent_id
--   GROUP BY 1;
--   -- the saved pairs:
--   SELECT CASE
--            WHEN lower(regexp_replace(regexp_replace(regexp_replace(a.session_pair->>'model', '^claude/', ''), '^(ibm|cb|anthropic|openai|bob|bedrock)/', ''), '\[1m\]$', ''))
--                 IN ('haiku','opus','sonnet','fable','default') THEN 'tier: bedrock keeps, others null'
--            WHEN split_part(regexp_replace(a.session_pair->>'model', '^claude/', ''), '/', 1)
--                 IN ('ibm','cb','anthropic','openai','bedrock','bob') THEN 'keep'
--            WHEN a.session_pair->>'provider' IS NOT NULL THEN 'qualify by the pair''s provider'
--            ELSE 'qualify by the agent''s one provider, else null' END AS outcome, count(*)
--   FROM agents a WHERE a.session_pair ? 'model' AND a.session_pair->>'model' IS NOT NULL
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
named AS (
  SELECT s.id,
         regexp_replace(s.spec->>'model', '^claude/', '') AS model,
         split_part(regexp_replace(s.spec->>'model', '^claude/', ''), '/', 1) AS head,
         lower(regexp_replace(regexp_replace(regexp_replace(s.spec->>'model', '^claude/', ''), '^(ibm|cb|anthropic|openai|bob|bedrock)/', ''), '\[1m\]$', '')) AS stripped,
         p.n,
         p.alias
  FROM schedules s
  LEFT JOIN per_agent p ON p.agent_id = s.agent_id
  WHERE s.spec ? 'model'
),
bare AS (
  SELECT *,
         stripped IN ('haiku', 'opus', 'sonnet', 'fable') AS tier
  FROM named
  WHERE head NOT IN ('ibm', 'cb', 'anthropic', 'openai', 'bedrock', 'bob')
     OR (stripped IN ('haiku', 'opus', 'sonnet', 'fable', 'default') AND head <> 'bedrock')
)
UPDATE schedules s
SET spec = CASE
             WHEN b.stripped = 'default' THEN s.spec - 'model'
             WHEN b.tier AND b.n = 1 AND b.alias = 'bedrock' THEN jsonb_set(s.spec, '{model}', to_jsonb('bedrock/' || b.stripped))
             WHEN b.tier THEN (s.spec - 'model') || '{"migrationNote": "model cleared: a Claude Code tier name names no provider model; pick the provider''s model"}'::jsonb
             WHEN b.n = 1 THEN jsonb_set(s.spec, '{model}', to_jsonb(b.alias || '/' || b.model))
             ELSE (s.spec - 'model') || '{"migrationNote": "model cleared: the old name named no provider and the agent holds none or several"}'::jsonb
           END,
    updated_at = now()
FROM bare b
WHERE b.id = s.id;
--> statement-breakpoint
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
pairs AS (
  SELECT a.id,
         regexp_replace(a.session_pair->>'model', '^claude/', '') AS model,
         split_part(regexp_replace(a.session_pair->>'model', '^claude/', ''), '/', 1) AS head,
         lower(regexp_replace(regexp_replace(regexp_replace(a.session_pair->>'model', '^claude/', ''), '^(ibm|cb|anthropic|openai|bob|bedrock)/', ''), '\[1m\]$', '')) AS stripped,
         COALESCE(
           (SELECT al.alias FROM alias_of al WHERE al.connection_id = a.session_pair->>'provider' LIMIT 1),
           (SELECT p.alias FROM per_agent p WHERE p.agent_id = a.id AND p.n = 1)
         ) AS alias
  FROM agents a
  WHERE a.session_pair ? 'model'
    AND a.session_pair->>'model' IS NOT NULL
),
fix AS (
  SELECT *,
         stripped IN ('haiku', 'opus', 'sonnet', 'fable', 'default') AS tier
  FROM pairs
  WHERE head NOT IN ('ibm', 'cb', 'anthropic', 'openai', 'bedrock', 'bob')
     OR (stripped IN ('haiku', 'opus', 'sonnet', 'fable', 'default') AND head <> 'bedrock')
)
UPDATE agents a
SET session_pair = CASE
                     WHEN f.tier AND f.alias = 'bedrock' AND f.stripped <> 'default' THEN jsonb_set(a.session_pair, '{model}', to_jsonb('bedrock/' || f.stripped))
                     WHEN f.tier THEN jsonb_set(a.session_pair, '{model}', 'null'::jsonb)
                     WHEN f.alias IS NOT NULL THEN jsonb_set(a.session_pair, '{model}', to_jsonb(f.alias || '/' || f.model))
                     ELSE jsonb_set(a.session_pair, '{model}', 'null'::jsonb)
                   END
FROM fix f
WHERE f.id = a.id;
