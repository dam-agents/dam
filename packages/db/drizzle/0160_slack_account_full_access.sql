-- A Slack Account connection is now read only unless it has full access: the
-- gateway lets only Slack's read tools pass without it. Every connection made
-- before this could post as its owner, so each one says so with fullAccess
-- rather than being narrowed silently, which would stop agents that post
-- today. Its owner can switch it to read only afterwards.
UPDATE connections
SET auth = auth || '{"fullAccess": true}'::jsonb, updated_at = now()
WHERE template_id = 'slack'
  AND auth ->> 'kind' = 'oauth'
  AND NOT (auth ? 'fullAccess');
