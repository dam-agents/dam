-- Every GitHub sign-in made through the GitHub App, and every GitHub App
-- installation, becomes a parent holding the credential plus one connection
-- made from it. The connection keeps its id, name, inputs, contributions,
-- agents and per-connection Secret, so nothing an agent holds changes; the new
-- parent shares that Secret, which already holds the credential. An unnarrowed
-- connection says so with fullAccess rather than being narrowed silently, which
-- would cut agents off. A sign-in that never completed becomes a parent alone:
-- it gave nothing yet, so its grants go and its agents are delivered again.
--
-- An installation drops what only the connection made from it uses: the scope
-- and the token's expiry, since it mints nothing of its own. A sign-in keeps
-- its scope until its first renewal by a release that knows parents: an older
-- api-server still serving during the rollout renews it as a plain sign-in and
-- must derive the same narrowed token for the one connection, never inject the
-- user token. The connection drops what only the parent uses: the refresh token of a
-- sign-in, which renews every connection made from it. It keeps its own token
-- in the shared Secret's scoped_token field, so the user token in access_token
-- stays the parent's alone; the field fills at the sign-in's next renewal, and
-- until then the gateway injects the token already in the Secret.
-- The parent's id is derived from the connection's, so each one is made once.
UPDATE connections
SET is_parent = true, updated_at = now()
WHERE template_id IN ('github', 'github-enterprise')
  AND auth ->> 'kind' = 'oauth'
  AND auth -> 'connectedAt' IS NULL
  AND auth -> 'expiresAt' IS NULL
  AND parent_id IS NULL;
--> statement-breakpoint
WITH removed AS (
  DELETE FROM connection_grants g
  USING connections c
  WHERE c.id = g.connection_id AND c.is_parent
  RETURNING g.agent_id
)
UPDATE runtime_state_outbox o
SET version = o.version + 1,
    last_enqueued_at = now()
WHERE o.agent_id IN (SELECT agent_id FROM removed);
--> statement-breakpoint
INSERT INTO connections (id, owner, template_id, name, inputs, auth, contributions, is_parent, created_at, updated_at)
SELECT 'conn-' || substr(md5(c.id || ':parent'), 1, 12), c.owner, c.template_id, c.name,
  c.inputs - 'repositories' - 'repositoryIds' - 'permissions' - 'fullAccess',
  CASE c.auth ->> 'kind'
    WHEN 'oauth' THEN c.auth - 'fullAccess'
    ELSE c.auth - 'repositories' - 'repositoryIds' - 'permissions' - 'fullAccess'
      - 'expiresAt' - 'refreshFailedAt' - 'refreshBackoff'
  END,
  c.contributions, true, c.created_at, now()
FROM connections c
WHERE c.parent_id IS NULL
  AND NOT c.is_parent
  AND (
    (c.template_id IN ('github', 'github-enterprise') AND c.auth ->> 'kind' = 'oauth')
    OR (c.template_id IN ('github-app', 'github-enterprise-app') AND c.auth ->> 'kind' = 'github-app')
  );
--> statement-breakpoint
UPDATE connections c
SET parent_id = 'conn-' || substr(md5(c.id || ':parent'), 1, 12),
  auth = CASE c.auth ->> 'kind'
    WHEN 'oauth' THEN
      jsonb_set(c.auth - 'refreshTokenRef' - 'refreshBackoff',
        '{accessTokenRef,field}', '"scoped_token"')
      || CASE WHEN c.auth -> 'githubUserTokenScope' IS NULL
        THEN '{"fullAccess": true}'::jsonb ELSE '{}'::jsonb END
    ELSE
      c.auth
      || CASE WHEN c.auth -> 'repositories' IS NULL
          AND c.auth -> 'repositoryIds' IS NULL
          AND c.auth -> 'permissions' IS NULL
        THEN '{"fullAccess": true}'::jsonb ELSE '{}'::jsonb END
  END,
  updated_at = now()
WHERE c.parent_id IS NULL
  AND NOT c.is_parent
  AND (
    (c.template_id IN ('github', 'github-enterprise') AND c.auth ->> 'kind' = 'oauth')
    OR (c.template_id IN ('github-app', 'github-enterprise-app') AND c.auth ->> 'kind' = 'github-app')
  );
