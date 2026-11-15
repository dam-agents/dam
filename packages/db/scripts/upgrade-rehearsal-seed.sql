-- Synthetic rows for the upgrade rehearsal, written against the schema of the
-- release being upgraded from (v0.2.26). One row per shape a migration between
-- that release and main rewrites or deletes, so each WHERE branch of 0118,
-- 0123, 0130, 0136, 0137 (and the backfills of 0119, 0126) is taken at least
-- once. GitHub sign-in shapes follow prod's 2026-11-10 counts, scaled down
-- (57:4 github and 112:1 github-enterprise connections completed:incomplete),
-- plus the shapes prod lacks.
--
-- Ids are stable and prefixed `seed-`, so the assertions can name them.

-- Agents the grants and the invocations point at. `seed-inv-helloed` is the
-- target of an Invocation whose runtime has said hello: 0130 stamps that one's
-- started_at from its created_at while it still runs.
INSERT INTO agents (id, owner_sub, runtime_last_hello_at) VALUES
  ('seed-agent-1', 'owner-a', NULL),
  ('seed-agent-2', 'owner-a', NULL),
  ('seed-agent-3', 'owner-a', NULL),
  ('seed-agent-4', 'owner-b', NULL),
  ('seed-inv-helloed', 'owner-a', now());

-- Connections. A GitHub App sign-in is one row; 0118 turns a completed one into
-- a parent plus this row as its child, and an incomplete one into a parent
-- alone. An installation (kind github-app) is likewise parent plus child.
INSERT INTO connections (id, owner, template_id, name, inputs, auth, contributions) VALUES
  -- github sign-in, completed, narrowed by a user-token scope (no fullAccess after 0118)
  ('seed-conn-gh-complete-narrowed', 'owner-a', 'github', 'gh narrowed',
   '{}'::jsonb,
   '{"kind":"oauth","clientId":"cid","scopes":["repo"],"tokenUrl":"https://github.com/login/oauth/access_token",
     "authorizationUrl":"https://github.com/login/oauth/authorize","connectedAt":1790000000000,
     "expiresAt":1790003600000,"accessTokenRef":{"path":"seed-conn-gh-complete-narrowed","field":"access_token"},
     "refreshTokenRef":{"path":"seed-conn-gh-complete-narrowed","field":"refresh_token"},
     "refreshBackoff":{"failures":1,"nextAttempt":1790000100000},
     "githubUserTokenScope":{"targetId":42,"targetLogin":"alice","repositoryIds":[7],"permissions":{"contents":"read"}}}'::jsonb,
   '[{"kind":"egress-inject","host":"api.github.com"},{"kind":"mcp-server","name":"gh"}]'::jsonb),
  -- github sign-in, completed, unnarrowed (gets fullAccess after 0118)
  ('seed-conn-gh-complete-full', 'owner-a', 'github', 'gh full',
   '{"repositories":"7,8"}'::jsonb,
   '{"kind":"oauth","clientId":"cid","scopes":["repo"],"tokenUrl":"https://github.com/login/oauth/access_token",
     "authorizationUrl":"https://github.com/login/oauth/authorize","connectedAt":1790000000000,
     "expiresAt":1790003600000,"accessTokenRef":{"path":"seed-conn-gh-complete-full","field":"access_token"},
     "refreshTokenRef":{"path":"seed-conn-gh-complete-full","field":"refresh_token"}}'::jsonb,
   '[]'::jsonb),
  -- github sign-in, connected but never expiring: only the expiresAt term of 0118's WHERE can split it
  ('seed-conn-gh-connected-only', 'owner-a', 'github', 'gh connected only',
   '{}'::jsonb,
   '{"kind":"oauth","clientId":"cid","scopes":["repo"],"tokenUrl":"https://github.com/login/oauth/access_token",
     "authorizationUrl":"https://github.com/login/oauth/authorize","connectedAt":1790000000000,
     "accessTokenRef":{"path":"seed-conn-gh-connected-only","field":"access_token"},
     "refreshTokenRef":{"path":"seed-conn-gh-connected-only","field":"refresh_token"}}'::jsonb,
   '[]'::jsonb),
  -- github sign-in with an expiry but no connectedAt: only the connectedAt term can split it
  ('seed-conn-gh-expires-only', 'owner-b', 'github', 'gh expires only',
   '{}'::jsonb,
   '{"kind":"oauth","clientId":"cid","scopes":["repo"],"tokenUrl":"https://github.com/login/oauth/access_token",
     "authorizationUrl":"https://github.com/login/oauth/authorize","expiresAt":1790003600000,
     "accessTokenRef":{"path":"seed-conn-gh-expires-only","field":"access_token"},
     "refreshTokenRef":{"path":"seed-conn-gh-expires-only","field":"refresh_token"}}'::jsonb,
   '[]'::jsonb),
  -- github sign-in that never completed, with grants: becomes a parent alone and loses them
  ('seed-conn-gh-incomplete-granted', 'owner-b', 'github', 'gh incomplete granted',
   '{}'::jsonb,
   '{"kind":"oauth","clientId":"cid","scopes":["repo"],"tokenUrl":"https://github.com/login/oauth/access_token",
     "authorizationUrl":"https://github.com/login/oauth/authorize",
     "accessTokenRef":{"path":"seed-conn-gh-incomplete-granted","field":"access_token"}}'::jsonb,
   '[]'::jsonb),
  -- github sign-in that never completed, granted to an agent that already lost another grant
  ('seed-conn-gh-incomplete-second', 'owner-b', 'github', 'gh incomplete second',
   '{}'::jsonb,
   '{"kind":"oauth","clientId":"cid","scopes":["repo"],"tokenUrl":"https://github.com/login/oauth/access_token",
     "authorizationUrl":"https://github.com/login/oauth/authorize",
     "accessTokenRef":{"path":"seed-conn-gh-incomplete-second","field":"access_token"}}'::jsonb,
   '[]'::jsonb),
  -- github sign-in whose auth spells its two timestamps as JSON null instead of
  -- omitting them: `auth -> 'connectedAt' IS NULL` is false for a JSON null, so
  -- 0118's incomplete-sign-in UPDATE skips it and the split treats it as completed
  ('seed-conn-gh-json-null', 'owner-b', 'github', 'gh json null',
   '{}'::jsonb,
   '{"kind":"oauth","clientId":"cid","scopes":["repo"],"tokenUrl":"https://github.com/login/oauth/access_token",
     "authorizationUrl":"https://github.com/login/oauth/authorize","connectedAt":null,"expiresAt":null,
     "accessTokenRef":{"path":"seed-conn-gh-json-null","field":"access_token"}}'::jsonb,
   '[]'::jsonb),
  -- github-enterprise sign-in, completed, unnarrowed
  ('seed-conn-ghe-complete', 'owner-a', 'github-enterprise', 'ghe complete',
   '{}'::jsonb,
   '{"kind":"oauth","clientId":"cid","scopes":["repo"],"tokenUrl":"https://ghe.example/login/oauth/access_token",
     "authorizationUrl":"https://ghe.example/login/oauth/authorize","connectedAt":1790000000000,
     "expiresAt":1790003600000,"host":"ghe.example",
     "accessTokenRef":{"path":"seed-conn-ghe-complete","field":"access_token"},
     "refreshTokenRef":{"path":"seed-conn-ghe-complete","field":"refresh_token"}}'::jsonb,
   '[]'::jsonb),
  -- github-enterprise sign-in that never completed, no grants: prod's shape
  ('seed-conn-ghe-incomplete', 'owner-b', 'github-enterprise', 'ghe incomplete',
   '{}'::jsonb,
   '{"kind":"oauth","clientId":"cid","scopes":["repo"],"tokenUrl":"https://ghe.example/login/oauth/access_token",
     "authorizationUrl":"https://ghe.example/login/oauth/authorize","host":"ghe.example",
     "accessTokenRef":{"path":"seed-conn-ghe-incomplete","field":"access_token"}}'::jsonb,
   '[]'::jsonb),
  -- GitHub App installation, unnarrowed: 0118 gives the child fullAccess and drops the parent's expiry bookkeeping
  ('seed-conn-gha-unnarrowed', 'owner-a', 'github-app', 'gha unnarrowed',
   '{}'::jsonb,
   '{"kind":"github-app","appId":"1234","installationId":"5678",
     "privateKeyRef":{"path":"seed-conn-gha-unnarrowed","field":"private_key"},
     "accessTokenRef":{"path":"seed-conn-gha-unnarrowed","field":"access_token"},
     "apiBaseUrl":"https://api.github.com","connectedAt":1790000000000,"expiresAt":1790003600000,
     "refreshFailedAt":1790002000000,"refreshBackoff":{"failures":2,"nextAttempt":1790000100000}}'::jsonb,
   '[]'::jsonb),
  -- GitHub App installation, narrowed by repositories and permissions
  ('seed-conn-gha-narrowed', 'owner-a', 'github-app', 'gha narrowed',
   '{}'::jsonb,
   '{"kind":"github-app","appId":"1234","installationId":"5679",
     "privateKeyRef":{"path":"seed-conn-gha-narrowed","field":"private_key"},
     "accessTokenRef":{"path":"seed-conn-gha-narrowed","field":"access_token"},
     "apiBaseUrl":"https://api.github.com","connectedAt":1790000000000,"expiresAt":1790003600000,
     "repositories":["acme/app"],"permissions":{"contents":"write"}}'::jsonb,
   '[]'::jsonb),
  -- GitHub App installation narrowed by permissions alone: 0118 tests each scope
  -- key on its own, so any one of them must keep the child from fullAccess
  ('seed-conn-gha-permissions-only', 'owner-a', 'github-app', 'gha permissions only',
   '{}'::jsonb,
   '{"kind":"github-app","appId":"1234","installationId":"5680",
     "privateKeyRef":{"path":"seed-conn-gha-permissions-only","field":"private_key"},
     "accessTokenRef":{"path":"seed-conn-gha-permissions-only","field":"access_token"},
     "apiBaseUrl":"https://api.github.com","connectedAt":1790000000000,"expiresAt":1790003600000,
     "permissions":{"contents":"read","issues":"write"}}'::jsonb,
   '[{"kind":"egress-inject","host":"api.github.com"}]'::jsonb),
  -- github-enterprise-app installation, narrowed by repository ids only
  ('seed-conn-ghea-narrowed', 'owner-b', 'github-enterprise-app', 'ghea narrowed',
   '{}'::jsonb,
   '{"kind":"github-app","appId":"99","installationId":"100",
     "privateKeyRef":{"path":"seed-conn-ghea-narrowed","field":"private_key"},
     "accessTokenRef":{"path":"seed-conn-ghea-narrowed","field":"access_token"},
     "apiBaseUrl":"https://ghe.example/api/v3","host":"ghe.example",
     "connectedAt":1790000000000,"expiresAt":1790003600000,"repositoryIds":[7,8]}'::jsonb,
   '[]'::jsonb),
  -- github-enterprise-app installation, unnarrowed
  ('seed-conn-ghea-unnarrowed', 'owner-b', 'github-enterprise-app', 'ghea unnarrowed',
   '{}'::jsonb,
   '{"kind":"github-app","appId":"99","installationId":"101",
     "privateKeyRef":{"path":"seed-conn-ghea-unnarrowed","field":"private_key"},
     "accessTokenRef":{"path":"seed-conn-ghea-unnarrowed","field":"access_token"},
     "apiBaseUrl":"https://ghe.example/api/v3","host":"ghe.example",
     "connectedAt":1790000000000,"expiresAt":1790003600000}'::jsonb,
   '[]'::jsonb),
  -- connections 0118 must not touch: other templates, and a github template that is not a sign-in or an installation
  ('seed-conn-slack-oauth', 'owner-a', 'slack', 'slack',
   '{}'::jsonb,
   '{"kind":"oauth","clientId":"cid","scopes":[],"tokenUrl":"https://slack.com/api/oauth.v2.access",
     "authorizationUrl":"https://slack.com/oauth/v2/authorize","connectedAt":1790000000000,
     "expiresAt":1790003600000,"accessTokenRef":{"path":"seed-conn-slack-oauth","field":"access_token"}}'::jsonb,
   '[{"kind":"egress-inject","host":"slack.com"}]'::jsonb),
  ('seed-conn-linear-oauth', 'owner-b', 'linear', 'linear',
   '{}'::jsonb,
   '{"kind":"oauth","clientId":"cid","scopes":[],"tokenUrl":"https://api.linear.app/oauth/token",
     "authorizationUrl":"https://linear.app/oauth/authorize","connectedAt":1790000000000,
     "accessTokenRef":{"path":"seed-conn-linear-oauth","field":"access_token"}}'::jsonb,
   '[]'::jsonb),
  ('seed-conn-github-header', 'owner-a', 'github', 'gh header',
   '{}'::jsonb,
   '{"kind":"header","valueRef":{"path":"seed-conn-github-header","field":"value"},
     "headerName":"Authorization","valueFormat":"Bearer {value}"}'::jsonb,
   '[]'::jsonb);

-- The bulk of prod's sign-ins, scaled down: prod reads 57 completed github and
-- 112 completed github-enterprise oauth connections, 4 and 1 never completed.
-- 9 more github and 13 more enterprise here give each template 14 completed
-- rows, so 0118's split runs over a table of prod's shape rather than a handful
-- of rows. Passwordless and unnarrowed, like prod's oldest sign-ins.
INSERT INTO connections (id, owner, template_id, name, inputs, auth, contributions)
SELECT 'seed-conn-bulk-' || template_id || '-' || i, 'owner-c', template_id, 'bulk ' || template_id || ' ' || i, '{}'::jsonb,
  jsonb_build_object(
    'kind', 'oauth', 'clientId', 'cid', 'scopes', jsonb_build_array('repo'),
    'tokenUrl', 'https://github.com/login/oauth/access_token',
    'authorizationUrl', 'https://github.com/login/oauth/authorize',
    'connectedAt', 1790000000000, 'expiresAt', 1790003600000,
    'accessTokenRef', jsonb_build_object('path', 'seed-conn-bulk-' || template_id || '-' || i, 'field', 'access_token'),
    'refreshTokenRef', jsonb_build_object('path', 'seed-conn-bulk-' || template_id || '-' || i, 'field', 'refresh_token')),
  '[]'::jsonb
FROM (VALUES ('github', 9), ('github-enterprise', 13)) AS t(template_id, rows), generate_series(1, rows) AS i;

-- Grants. Those on a connection 0118 turns into a parent are deleted and their
-- agents re-delivered through the outbox; those on the child connections and on
-- the untouched connections stay.
INSERT INTO connection_grants (connection_id, agent_id, preferred) VALUES
  ('seed-conn-gh-incomplete-granted', 'seed-agent-1', true),
  ('seed-conn-gh-incomplete-granted', 'seed-agent-2', false),
  ('seed-conn-gh-incomplete-second', 'seed-agent-1', false),
  ('seed-conn-gh-complete-narrowed', 'seed-agent-3', false),
  ('seed-conn-gha-narrowed', 'seed-agent-4', true),
  ('seed-conn-slack-oauth', 'seed-agent-3', true);

INSERT INTO runtime_state_outbox (agent_id, version) VALUES
  ('seed-agent-1', 7),
  ('seed-agent-2', 3),
  ('seed-agent-3', 11),
  ('seed-agent-4', 5);

-- Invocations, one per status and started/shape combination 0116, 0130 and 0136
-- act on. 0136 gives every row whose status is not `idle` one invocation_runs
-- row under its own id; 0130 stamps started_at on everything but a running row
-- whose target has not said hello.
INSERT INTO invocations (id, driver_agent_id, root_driver_id, owner, prompt, script, cpu, memory,
                         ttl_ms, result_schema, result, exit_code, output, output_expires_at,
                         status, error_reason, expires_at, completed_at, reaped_at, origin,
                         driver_session_id, awaited_until, claimed_until, delivered_at, woke_at) VALUES
  ('seed-inv-idle', 'seed-agent-1', 'seed-agent-1', 'owner-a', 'idle prompt', NULL, NULL, NULL,
   NULL, NULL, NULL, NULL, NULL, NULL, 'idle', NULL, now() + interval '1 hour', NULL, NULL, 'script',
   NULL, NULL, NULL, NULL, NULL),
  ('seed-inv-helloed', 'seed-agent-1', 'seed-agent-1', 'owner-a', 'running, target said hello', NULL, '1', '1Gi',
   NULL, NULL, NULL, NULL, NULL, NULL, 'running', NULL, now() + interval '1 hour', NULL, NULL, 'script',
   'seed-session-1', now() + interval '30 minutes', now() + interval '20 minutes', now() - interval '5 minutes',
   now() - interval '4 minutes'),
  ('seed-inv-waiting', 'seed-agent-2', 'seed-agent-2', 'owner-a', 'running, no hello yet', NULL, '500m', '512Mi',
   NULL, NULL, NULL, NULL, NULL, NULL, 'running', NULL, now() + interval '1 hour', NULL, NULL, 'script',
   'seed-session-2', now() + interval '30 minutes', NULL, NULL, NULL),
  ('seed-inv-done', 'seed-agent-3', 'seed-agent-3', 'owner-a', 'done', NULL, '2', '2Gi',
   60000, '{"type":"object"}'::jsonb, '{"ok":true}'::jsonb, 0, '{"text":"out"}'::jsonb, now() + interval '1 hour',
   'done', NULL, now() + interval '1 hour', now(), NULL, 'tool',
   'seed-session-1', now() - interval '40 minutes', now() - interval '50 minutes', now() - interval '45 minutes',
   now() - interval '44 minutes'),
  ('seed-inv-failed', 'seed-agent-3', 'seed-agent-3', 'owner-a', 'failed', 'console.log(1)', '1', '1Gi',
   NULL, NULL, NULL, 1, NULL, NULL, 'failed', 'exit 1', now() + interval '1 hour', now(), NULL, 'script',
   'seed-session-3', now() - interval '30 minutes', now() - interval '40 minutes', NULL, NULL),
  ('seed-inv-reaped', 'seed-agent-4', 'seed-agent-4', 'owner-b', 'done and reaped', NULL, NULL, NULL,
   NULL, NULL, NULL, NULL, NULL, NULL, 'done', NULL, now() + interval '1 hour', now(), now(), 'script',
   'seed-session-4', NULL, NULL, NULL, now() - interval '50 minutes');

-- The saved per-user features 0137 deletes one of, beside features it keeps.
INSERT INTO user_features (owner, feature, enabled) VALUES
  ('owner-a', 'interactive-artifacts', true),
  ('owner-b', 'interactive-artifacts', false),
  ('owner-c', 'interactive-artifacts', true),
  ('owner-a', 'sandbox', true),
  ('owner-b', 'artifacts', false);

-- Environment access lists 0123 turns into one row per person: a plain list, a
-- list with a duplicate email, and an empty one.
INSERT INTO environment_access_lists (owning_agent_id, owner, emails) VALUES
  ('seed-env-agent-1', 'owner-a', '["a@example.com","b@example.com"]'::jsonb),
  ('seed-env-agent-2', 'owner-a', '["a@example.com","a@example.com"]'::jsonb),
  ('seed-env-agent-3', 'owner-b', '[]'::jsonb);

INSERT INTO environments (agent_id, owning_agent_id, owner, name, host, endpoints, access, expires_at) VALUES
  ('seed-env-1', 'seed-env-agent-1', 'owner-a', 'narrowed env', 'seed-env-1.example', '[]'::jsonb,
   '["a@example.com"]'::jsonb, now() + interval '7 days'),
  ('seed-env-2', 'seed-env-agent-2', 'owner-a', 'open env', 'seed-env-2.example', '[]'::jsonb,
   NULL, now() + interval '7 days');

-- Spend rows 0119's already-applied column and index must leave alone.
INSERT INTO spend_calls (calling_agent_id, call_id, owner_sub, payer_agent_id, session_id, started_at, unit, cost_micros) VALUES
  ('seed-agent-1', 'seed-call-unbooked', 'owner-a', 'seed-agent-1', '', now() - interval '1 hour', 'input_token', 12),
  ('seed-agent-1', 'seed-call-booked', 'owner-a', 'seed-agent-1', 'seed-session-1', now() - interval '2 hour', 'output_token', 34);

-- A satellite 0126 must give an incarnation of its own.
INSERT INTO satellites (owner, name, max_concurrent, tools) VALUES
  ('owner-a', 'seed-satellite', 2, '[]'::jsonb);

-- An attention record, the shape 0115 widens.
INSERT INTO attention_records (agent_id, session_id, owner_sub, mode, type, created_at) VALUES
  ('seed-agent-1', 'seed-session-1', 'owner-a', 'interactive', 'question', now());
