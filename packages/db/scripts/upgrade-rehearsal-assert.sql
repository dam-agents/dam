-- Compares the upgraded database with the pre-upgrade rows (rehearsal_rows) and
-- the two snapshots (rehearsal_snapshot) against what the migrations 0109-0137
-- and their comments say they do. Every check names itself; any failure is
-- collected and raised at the end, so `psql -v ON_ERROR_STOP=1` exits non-zero.
CREATE TEMP TABLE rehearsal_failure (name text NOT NULL, expected text NOT NULL, actual text);

-- Count deltas, each traced to the sentence of the migration comment it comes
-- from:
--   0118  "becomes a parent holding the credential plus one connection made
--          from it": +33 connections = 11 hand-written parents (4 completed
--          github sign-ins, 1 completed github-enterprise sign-in, 5
--          installations, and the sign-in whose two timestamps are JSON null --
--          see the seed: `auth -> 'connectedAt' IS NULL` is false for a JSON
--          null, so that one is split as if completed) plus the 22 parents of
--          the bulk sign-ins.
--   0118  "An unnarrowed connection says so with fullAccess": +29 rows = 7
--          hand-written plus all 22 bulk children, which carry no scope.
--   0118  "A sign-in that never completed becomes a parent alone: it gave
--          nothing yet, so its grants go": -3 grants.
--   0118  "and its agents are delivered again": the outbox version sum +2, one
--          per agent, for 3 deleted grants over 2 agents (one UPDATE).
--   0137  "the saved per-user choice has no reader": -3 user_features rows.
--   Everything else untouched: no row counts of the other tables move.
INSERT INTO rehearsal_failure
SELECT e.name, e.expected::text, e.actual::text
FROM (VALUES
  ('delta.agents', 0, (SELECT a.n - b.n FROM rehearsal_snapshot b JOIN rehearsal_snapshot a USING (name) WHERE b.label = 'before' AND a.label = 'after' AND a.name = 'agents')),
  ('delta.attention_records', 0, (SELECT a.n - b.n FROM rehearsal_snapshot b JOIN rehearsal_snapshot a USING (name) WHERE b.label = 'before' AND a.label = 'after' AND a.name = 'attention_records')),
  ('delta.connection_grants', -3, (SELECT a.n - b.n FROM rehearsal_snapshot b JOIN rehearsal_snapshot a USING (name) WHERE b.label = 'before' AND a.label = 'after' AND a.name = 'connection_grants')),
  ('delta.connection_grants.on_incomplete_github_signins', -3, (SELECT a.n - b.n FROM rehearsal_snapshot b JOIN rehearsal_snapshot a USING (name) WHERE b.label = 'before' AND a.label = 'after' AND a.name = 'connection_grants.on_incomplete_github_signins')),
  ('delta.connections', 33, (SELECT a.n - b.n FROM rehearsal_snapshot b JOIN rehearsal_snapshot a USING (name) WHERE b.label = 'before' AND a.label = 'after' AND a.name = 'connections')),
  ('delta.connections.full_access', 29, (SELECT a.n - b.n FROM rehearsal_snapshot b JOIN rehearsal_snapshot a USING (name) WHERE b.label = 'before' AND a.label = 'after' AND a.name = 'connections.full_access')),
  ('delta.connections.github_enterprise_oauth_complete', 14, (SELECT a.n - b.n FROM rehearsal_snapshot b JOIN rehearsal_snapshot a USING (name) WHERE b.label = 'before' AND a.label = 'after' AND a.name = 'connections.github_enterprise_oauth_complete')),
  ('delta.connections.github_enterprise_oauth_incomplete', 0, (SELECT a.n - b.n FROM rehearsal_snapshot b JOIN rehearsal_snapshot a USING (name) WHERE b.label = 'before' AND a.label = 'after' AND a.name = 'connections.github_enterprise_oauth_incomplete')),
  ('delta.connections.github_oauth_complete', 12, (SELECT a.n - b.n FROM rehearsal_snapshot b JOIN rehearsal_snapshot a USING (name) WHERE b.label = 'before' AND a.label = 'after' AND a.name = 'connections.github_oauth_complete')),
  ('delta.connections.github_oauth_incomplete', 0, (SELECT a.n - b.n FROM rehearsal_snapshot b JOIN rehearsal_snapshot a USING (name) WHERE b.label = 'before' AND a.label = 'after' AND a.name = 'connections.github_oauth_incomplete')),
  ('delta.connections.github_oauth_timestamps_json_null', 1, (SELECT a.n - b.n FROM rehearsal_snapshot b JOIN rehearsal_snapshot a USING (name) WHERE b.label = 'before' AND a.label = 'after' AND a.name = 'connections.github_oauth_timestamps_json_null')),
  ('delta.connections.installations', 5, (SELECT a.n - b.n FROM rehearsal_snapshot b JOIN rehearsal_snapshot a USING (name) WHERE b.label = 'before' AND a.label = 'after' AND a.name = 'connections.installations')),
  ('delta.connections.other_templates', 0, (SELECT a.n - b.n FROM rehearsal_snapshot b JOIN rehearsal_snapshot a USING (name) WHERE b.label = 'before' AND a.label = 'after' AND a.name = 'connections.other_templates')),
  ('delta.environment_access_lists', 0, (SELECT a.n - b.n FROM rehearsal_snapshot b JOIN rehearsal_snapshot a USING (name) WHERE b.label = 'before' AND a.label = 'after' AND a.name = 'environment_access_lists')),
  ('delta.environment_access_lists.emails', 0, (SELECT a.n - b.n FROM rehearsal_snapshot b JOIN rehearsal_snapshot a USING (name) WHERE b.label = 'before' AND a.label = 'after' AND a.name = 'environment_access_lists.emails')),
  ('delta.environments', 0, (SELECT a.n - b.n FROM rehearsal_snapshot b JOIN rehearsal_snapshot a USING (name) WHERE b.label = 'before' AND a.label = 'after' AND a.name = 'environments')),
  ('delta.invocations', 0, (SELECT a.n - b.n FROM rehearsal_snapshot b JOIN rehearsal_snapshot a USING (name) WHERE b.label = 'before' AND a.label = 'after' AND a.name = 'invocations')),
  ('delta.runtime_state_outbox', 0, (SELECT a.n - b.n FROM rehearsal_snapshot b JOIN rehearsal_snapshot a USING (name) WHERE b.label = 'before' AND a.label = 'after' AND a.name = 'runtime_state_outbox')),
  ('delta.runtime_state_outbox.version_sum', 2, (SELECT a.n - b.n FROM rehearsal_snapshot b JOIN rehearsal_snapshot a USING (name) WHERE b.label = 'before' AND a.label = 'after' AND a.name = 'runtime_state_outbox.version_sum')),
  ('delta.satellites', 0, (SELECT a.n - b.n FROM rehearsal_snapshot b JOIN rehearsal_snapshot a USING (name) WHERE b.label = 'before' AND a.label = 'after' AND a.name = 'satellites')),
  ('delta.spend_calls', 0, (SELECT a.n - b.n FROM rehearsal_snapshot b JOIN rehearsal_snapshot a USING (name) WHERE b.label = 'before' AND a.label = 'after' AND a.name = 'spend_calls')),
  ('delta.spend_calls.unstamped', 0, (SELECT a.n - b.n FROM rehearsal_snapshot b JOIN rehearsal_snapshot a USING (name) WHERE b.label = 'before' AND a.label = 'after' AND a.name = 'spend_calls.unstamped')),
  ('delta.user_features', -3, (SELECT a.n - b.n FROM rehearsal_snapshot b JOIN rehearsal_snapshot a USING (name) WHERE b.label = 'before' AND a.label = 'after' AND a.name = 'user_features')),
  ('delta.user_features.interactive_artifacts', -3, (SELECT a.n - b.n FROM rehearsal_snapshot b JOIN rehearsal_snapshot a USING (name) WHERE b.label = 'before' AND a.label = 'after' AND a.name = 'user_features.interactive_artifacts'))
) e(name, expected, actual)
WHERE e.actual IS DISTINCT FROM e.expected;

-- Rows an additive migration or a split keeps: every column of the pre-upgrade
-- row must still hold its value. `@>` is "the new row still contains the old
-- one", which tolerates a column a migration adds and nothing else.
INSERT INTO rehearsal_failure
SELECT 'kept.agents.changed', 'every pre-upgrade column keeps its value', string_agg(r.key, ', ')
FROM rehearsal_rows r
WHERE r.class = 'agents'
  AND NOT EXISTS (SELECT 1 FROM agents t WHERE t.id = r.key AND to_jsonb(t) @> r.payload)
GROUP BY () HAVING count(*) > 0;

INSERT INTO rehearsal_failure
SELECT 'kept.satellites.changed', 'every pre-upgrade column keeps its value', string_agg(r.key, ', ')
FROM rehearsal_rows r
WHERE r.class = 'satellites'
  AND NOT EXISTS (SELECT 1 FROM satellites t WHERE t.name = r.key AND to_jsonb(t) @> r.payload)
GROUP BY () HAVING count(*) > 0;

INSERT INTO rehearsal_failure
SELECT 'kept.attention_records.changed', 'every pre-upgrade column keeps its value', string_agg(r.key, ', ')
FROM rehearsal_rows r
WHERE r.class = 'attention_records'
  AND NOT EXISTS (SELECT 1 FROM attention_records t
                  WHERE t.agent_id || '|' || t.session_id || '|' || t.type = r.key AND to_jsonb(t) @> r.payload)
GROUP BY () HAVING count(*) > 0;

INSERT INTO rehearsal_failure
SELECT 'kept.environments.changed', 'every pre-upgrade column keeps its value', string_agg(r.key, ', ')
FROM rehearsal_rows r
WHERE r.class = 'environments'
  AND NOT EXISTS (SELECT 1 FROM environments t WHERE t.agent_id = r.key AND to_jsonb(t) @> r.payload)
GROUP BY () HAVING count(*) > 0;

INSERT INTO rehearsal_failure
SELECT 'kept.spend_calls.changed', 'every pre-upgrade column keeps its value', string_agg(r.key, ', ')
FROM rehearsal_rows r
WHERE r.class = 'spend_calls'
  AND NOT EXISTS (SELECT 1 FROM spend_calls t WHERE t.call_id = r.key AND to_jsonb(t) @> r.payload)
GROUP BY () HAVING count(*) > 0;

INSERT INTO rehearsal_failure
SELECT 'kept.environment_access_lists.changed', 'every pre-upgrade column keeps its value', string_agg(r.key, ', ')
FROM rehearsal_rows r
WHERE r.class = 'environment_access_lists'
  AND NOT EXISTS (SELECT 1 FROM environment_access_lists t WHERE t.owning_agent_id = r.key AND to_jsonb(t) = r.payload)
GROUP BY () HAVING count(*) > 0;

-- 0118 keeps the connection's identity, its inputs, its contributions and its
-- Secret paths; only the auth keys it moves (refreshTokenRef, refreshBackoff,
-- fullAccess, accessTokenRef.field) and the two columns 0117 adds may differ.
INSERT INTO rehearsal_failure
SELECT 'kept.connections.missing', 'every pre-upgrade connection still exists', string_agg(r.key, ', ')
FROM rehearsal_rows r
WHERE r.class = 'connections'
  AND NOT EXISTS (SELECT 1 FROM connections c WHERE c.id = r.key)
GROUP BY () HAVING count(*) > 0;

INSERT INTO rehearsal_failure
SELECT 'kept.connections.fields', 'name, inputs, contributions, owner, template_id and created_at keep their values', string_agg(r.key, ', ')
FROM rehearsal_rows r
JOIN connections c ON c.id = r.key
WHERE r.class = 'connections'
  AND (to_jsonb(c) - '{updated_at,parent_id,is_parent,auth}'::text[])
      IS DISTINCT FROM (r.payload - '{updated_at,parent_id,is_parent,auth}'::text[])
GROUP BY () HAVING count(*) > 0;

INSERT INTO rehearsal_failure
SELECT 'kept.connections.auth_scalars', 'every auth key but the four 0118 moves keeps its value', string_agg(r.key, ', ')
FROM rehearsal_rows r
JOIN connections c ON c.id = r.key
WHERE r.class = 'connections'
  AND (c.auth - '{refreshTokenRef,refreshBackoff,fullAccess,accessTokenRef}'::text[])
      IS DISTINCT FROM ((r.payload -> 'auth') - '{refreshTokenRef,refreshBackoff,fullAccess,accessTokenRef}'::text[])
GROUP BY () HAVING count(*) > 0;

INSERT INTO rehearsal_failure
SELECT 'kept.connections.token_path', 'each connection keeps its accessTokenRef Secret path', string_agg(r.key, ', ')
FROM rehearsal_rows r
JOIN connections c ON c.id = r.key
WHERE r.class = 'connections'
  AND c.auth -> 'accessTokenRef' ->> 'path'
      IS DISTINCT FROM r.payload -> 'auth' -> 'accessTokenRef' ->> 'path'
GROUP BY () HAVING count(*) > 0;

INSERT INTO rehearsal_failure
SELECT 'kept.connections.token_field', 'accessTokenRef.field moves to scoped_token only on a sign-in child', string_agg(r.key, ', ')
FROM rehearsal_rows r
JOIN connections c ON c.id = r.key
WHERE r.class = 'connections'
  AND c.auth -> 'accessTokenRef' ->> 'field' IS DISTINCT FROM
      CASE WHEN r.payload -> 'auth' ->> 'kind' = 'oauth' AND c.parent_id IS NOT NULL THEN 'scoped_token'
           ELSE r.payload -> 'auth' -> 'accessTokenRef' ->> 'field' END
GROUP BY () HAVING count(*) > 0;

INSERT INTO rehearsal_failure
SELECT 'kept.connections.refresh_token_paths', 'every refreshTokenRef Secret path survives, on the parent', string_agg(coalesce(d.path, '(null path)'), ', ')
FROM (
  (SELECT payload -> 'auth' -> 'refreshTokenRef' ->> 'path' AS path
   FROM rehearsal_rows WHERE class = 'connections' AND payload -> 'auth' -> 'refreshTokenRef' IS NOT NULL
   EXCEPT
   SELECT auth -> 'refreshTokenRef' ->> 'path' FROM connections WHERE auth -> 'refreshTokenRef' IS NOT NULL)
  UNION ALL
  (SELECT auth -> 'refreshTokenRef' ->> 'path' FROM connections WHERE auth -> 'refreshTokenRef' IS NOT NULL
   EXCEPT
   SELECT payload -> 'auth' -> 'refreshTokenRef' ->> 'path'
   FROM rehearsal_rows WHERE class = 'connections' AND payload -> 'auth' -> 'refreshTokenRef' IS NOT NULL)
) d
GROUP BY () HAVING count(*) > 0;

INSERT INTO rehearsal_failure
SELECT 'kept.connections.child_with_refresh_token', 'a child holds no refresh token; it renews through its parent', string_agg(id, ', ')
FROM connections
WHERE parent_id IS NOT NULL AND auth ? 'refreshTokenRef'
GROUP BY () HAVING count(*) > 0;

-- The narrowing rule of 0118, recomputed from the pre-upgrade auth instead of
-- read back from its own result: a sign-in child is unnarrowed without a
-- githubUserTokenScope, an App child without any of its three scope keys.
INSERT INTO rehearsal_failure
SELECT 'kept.connections.full_access_rule', 'fullAccess exactly on the unnarrowed children', string_agg(r.key, ', ')
FROM rehearsal_rows r
JOIN connections c ON c.id = r.key
WHERE r.class = 'connections' AND c.parent_id IS NOT NULL
  AND (c.auth ? 'fullAccess') IS DISTINCT FROM
      CASE WHEN r.payload -> 'auth' ->> 'kind' = 'oauth'
           THEN NOT (r.payload -> 'auth' ? 'githubUserTokenScope')
           ELSE NOT (r.payload -> 'auth' ? 'repositories'
                     OR r.payload -> 'auth' ? 'repositoryIds'
                     OR r.payload -> 'auth' ? 'permissions')
      END
GROUP BY () HAVING count(*) > 0;

-- 0118 gives a completed sign-in or an installation a parent that carries the
-- credential, one per child, and the child keeps the id, name and Secret.
INSERT INTO rehearsal_failure
SELECT 'split.parent_missing_or_mismatched', 'one parent per child, sharing its name, owner, template, Secret and created_at', string_agg(c.id, ', ')
FROM connections c
LEFT JOIN connections p ON p.id = c.parent_id
WHERE c.parent_id IS NOT NULL
  AND (p.id IS NULL OR NOT p.is_parent
       OR p.name IS DISTINCT FROM c.name
       OR p.owner IS DISTINCT FROM c.owner
       OR p.template_id IS DISTINCT FROM c.template_id
       OR p.created_at IS DISTINCT FROM c.created_at
       OR p.auth -> 'accessTokenRef' ->> 'path' IS DISTINCT FROM c.auth -> 'accessTokenRef' ->> 'path')
GROUP BY () HAVING count(*) > 0;

INSERT INTO rehearsal_failure
SELECT 'split.not_one_to_one', 'as many parents as children', count(*) || ' children, ' || count(DISTINCT parent_id) || ' parents'
FROM connections WHERE parent_id IS NOT NULL
HAVING count(*) <> count(DISTINCT parent_id);

INSERT INTO rehearsal_failure
SELECT 'split.parent_ids', $$every parent id is 'conn-' || substr(md5(child || ':parent'), 1, 12)$$, string_agg(id, ', ')
FROM connections
WHERE parent_id IS NOT NULL AND parent_id IS DISTINCT FROM 'conn-' || substr(md5(id || ':parent'), 1, 12)
GROUP BY () HAVING count(*) > 0;

INSERT INTO rehearsal_failure
SELECT 'split.parent_access_token_field', 'the parent keeps access_token in the shared Secret', string_agg(p.id, ', ')
FROM connections p
JOIN connections c ON c.parent_id = p.id
WHERE p.auth -> 'accessTokenRef' ->> 'field' IS DISTINCT FROM 'access_token'
   OR (p.auth ? 'refreshTokenRef') IS DISTINCT FROM
      (SELECT (r.payload -> 'auth') ? 'refreshTokenRef'
       FROM rehearsal_rows r WHERE r.class = 'connections' AND r.key = c.id)
GROUP BY () HAVING count(*) > 0;

INSERT INTO rehearsal_failure
SELECT 'split.oauth_parent_kept', 'a sign-in parent keeps the expiry and the scope an older api-server renews with', string_agg(p.id, ', ')
FROM connections p
JOIN connections c ON c.parent_id = p.id
JOIN rehearsal_rows r ON r.class = 'connections' AND r.key = c.id
WHERE r.payload -> 'auth' ->> 'kind' = 'oauth'
  AND ((p.auth ? 'expiresAt') IS DISTINCT FROM (r.payload -> 'auth' ? 'expiresAt')
       OR (p.auth ? 'githubUserTokenScope') IS DISTINCT FROM (r.payload -> 'auth' ? 'githubUserTokenScope'))
GROUP BY () HAVING count(*) > 0;

INSERT INTO rehearsal_failure
SELECT 'split.installation_parent_dropped', 'an installation parent drops the scope and the token expiry', string_agg(p.id, ', ')
FROM connections p
JOIN connections c ON c.parent_id = p.id
JOIN rehearsal_rows r ON r.class = 'connections' AND r.key = c.id
WHERE r.payload -> 'auth' ->> 'kind' = 'github-app'
  AND (p.auth ? 'expiresAt' OR p.auth ? 'refreshFailedAt' OR p.auth ? 'refreshBackoff'
       OR p.auth ? 'repositories' OR p.auth ? 'repositoryIds' OR p.auth ? 'permissions')
GROUP BY () HAVING count(*) > 0;

INSERT INTO rehearsal_failure
SELECT 'split.installation_parent_kept', 'an installation parent keeps the private key', string_agg(p.id, ', ')
FROM connections p
JOIN connections c ON c.parent_id = p.id
JOIN rehearsal_rows r ON r.class = 'connections' AND r.key = c.id
WHERE r.payload -> 'auth' ->> 'kind' = 'github-app'
  AND p.auth -> 'privateKeyRef' ->> 'path' IS DISTINCT FROM r.payload -> 'auth' -> 'privateKeyRef' ->> 'path'
GROUP BY () HAVING count(*) > 0;

-- The first statement of 0118, recomputed from the pre-upgrade auth: a github
-- or github-enterprise oauth connection with neither timestamp present becomes a
-- parent in place. `payload -> 'auth' -> 'connectedAt' IS NULL` is true only for
-- an absent key, which is what the migration's SQL tests.
INSERT INTO rehearsal_failure
SELECT 'split.is_parent_rule', 'is_parent exactly on the incomplete sign-ins', string_agg(r.key, ', ')
FROM rehearsal_rows r
JOIN connections c ON c.id = r.key
WHERE r.class = 'connections'
  AND c.is_parent IS DISTINCT FROM (
    r.payload ->> 'template_id' IN ('github', 'github-enterprise')
    AND r.payload -> 'auth' ->> 'kind' = 'oauth'
    AND r.payload -> 'auth' -> 'connectedAt' IS NULL
    AND r.payload -> 'auth' -> 'expiresAt' IS NULL)
GROUP BY () HAVING count(*) > 0;

INSERT INTO rehearsal_failure
SELECT 'split.incomplete_has_child', 'an incomplete sign-in is a parent alone', string_agg(r.key, ', ')
FROM rehearsal_rows r
JOIN connections c ON c.id = r.key
WHERE r.class = 'connections'
  AND c.is_parent
  AND EXISTS (SELECT 1 FROM connections child WHERE child.parent_id = c.id)
GROUP BY () HAVING count(*) > 0;

-- Grants: every grant 0118 does not delete survives unchanged, nothing is
-- added, and the only deletions are the ones on a parent. The predicate is the
-- migration's own, on the pre-upgrade snapshot.
INSERT INTO rehearsal_failure
SELECT 'kept.connection_grants.added', 'no grant appears', string_agg(g.connection_id || '|' || g.agent_id, ', ')
FROM connection_grants g
WHERE NOT EXISTS (SELECT 1 FROM rehearsal_rows r WHERE r.class = 'connection_grants' AND r.key = g.connection_id || '|' || g.agent_id)
GROUP BY () HAVING count(*) > 0;

INSERT INTO rehearsal_failure
SELECT 'kept.connection_grants.changed', 'a surviving grant keeps preferred and granted_at', string_agg(r.key, ', ')
FROM rehearsal_rows r
JOIN connection_grants g ON g.connection_id || '|' || g.agent_id = r.key
WHERE r.class = 'connection_grants' AND to_jsonb(g) IS DISTINCT FROM r.payload
GROUP BY () HAVING count(*) > 0;

INSERT INTO rehearsal_failure
SELECT 'kept.connection_grants.removed_unexpected', 'only a grant on an incomplete sign-in is deleted', string_agg(r.key, ', ')
FROM rehearsal_rows r
WHERE r.class = 'connection_grants'
  AND NOT EXISTS (SELECT 1 FROM connection_grants g WHERE g.connection_id || '|' || g.agent_id = r.key)
  AND NOT EXISTS (
    SELECT 1 FROM rehearsal_rows c
    WHERE c.class = 'connections' AND c.key = split_part(r.key, '|', 1)
      AND c.payload ->> 'template_id' IN ('github', 'github-enterprise')
      AND c.payload -> 'auth' ->> 'kind' = 'oauth'
      AND c.payload -> 'auth' -> 'connectedAt' IS NULL
      AND c.payload -> 'auth' -> 'expiresAt' IS NULL)
GROUP BY () HAVING count(*) > 0;

-- 0136 gives every invocation whose status is not idle one run under its own id
-- carrying the whole invocation payload; the idle one gets none.
INSERT INTO rehearsal_failure
SELECT 'kept.invocations.run_missing', 'every non-idle invocation became exactly one run', string_agg(r.key, ', ')
FROM rehearsal_rows r
WHERE r.class = 'invocations' AND r.payload ->> 'status' <> 'idle'
  AND NOT EXISTS (SELECT 1 FROM invocation_runs u WHERE u.id = r.key)
GROUP BY () HAVING count(*) > 0;

INSERT INTO rehearsal_failure
SELECT 'kept.invocations.run_extra', 'no run without a non-idle invocation', string_agg(u.id, ', ')
FROM invocation_runs u
WHERE NOT EXISTS (SELECT 1 FROM rehearsal_rows r
                  WHERE r.class = 'invocations' AND r.key = u.id AND r.payload ->> 'status' <> 'idle')
GROUP BY () HAVING count(*) > 0;

INSERT INTO rehearsal_failure
SELECT 'kept.invocations.run_fields', 'prompt, script, schema, TTL, result, output and the session/cursor fields are copied unchanged', string_agg(r.key, ', ')
FROM rehearsal_rows r
JOIN invocation_runs u ON u.id = r.key
WHERE r.class = 'invocations'
  AND (to_jsonb(u) - '{invocation_id,cancel_pending,session_id,started_at}'::text[])
      IS DISTINCT FROM
      (r.payload - '{cpu,memory,label,template_id,image,connections,reaped_at,transcript_captured,
        transcript_truncated,harness_config,driver_agent_id,root_driver_id,owner}'::text[])
GROUP BY () HAVING count(*) > 0;

-- 0130: a row that had started keeps its stamp, one that was waiting for room
-- is stamped by its first delivery, and a finished or delivered row counts as
-- started when it spawned.
INSERT INTO rehearsal_failure
SELECT 'kept.invocations.started_at', 'started_at follows 0130 for every carried-over run', string_agg(r.key, ', ')
FROM rehearsal_rows r
JOIN invocation_runs u ON u.id = r.key
WHERE r.class = 'invocations'
  AND u.started_at IS DISTINCT FROM coalesce(
    (r.payload ->> 'started_at')::timestamptz,
    CASE WHEN NOT EXISTS (
           SELECT 1 FROM rehearsal_rows a
           WHERE a.class = 'agents' AND a.key = u.id AND a.payload -> 'runtime_last_hello_at' IS NOT NULL)
         AND u.status = 'running' THEN NULL
    ELSE (r.payload ->> 'created_at')::timestamptz END)
GROUP BY () HAVING count(*) > 0;

-- 0123: one row per email of each list, trimmed and deduplicated, stamped with
-- the list's updated_at; an empty list contributes nothing.
INSERT INTO rehearsal_failure
SELECT 'kept.environment_members.mismatched', 'exactly the access lists, one row per email', string_agg(changed.email, ', ')
FROM (
  (SELECT l.key AS owning, e.email, (l.payload ->> 'updated_at')::timestamptz AS added_at
   FROM rehearsal_rows l, jsonb_array_elements_text(l.payload -> 'emails') AS e(email)
   WHERE l.class = 'environment_access_lists'
   EXCEPT
   SELECT owning_agent_id, email, added_at FROM agent_environment_members)
  UNION ALL
  (SELECT owning_agent_id, email, added_at FROM agent_environment_members
   EXCEPT
   SELECT l.key, e.email, (l.payload ->> 'updated_at')::timestamptz
   FROM rehearsal_rows l, jsonb_array_elements_text(l.payload -> 'emails') AS e(email)
   WHERE l.class = 'environment_access_lists')
) changed
GROUP BY () HAVING count(*) > 0;

-- 0137 deletes the interactive-artifacts flag and nothing else.
INSERT INTO rehearsal_failure
SELECT 'kept.user_features.added', 'no user feature appears', string_agg(f.owner || '|' || f.feature, ', ')
FROM user_features f
WHERE NOT EXISTS (SELECT 1 FROM rehearsal_rows r WHERE r.class = 'user_features' AND r.key = f.owner || '|' || f.feature)
GROUP BY () HAVING count(*) > 0;

INSERT INTO rehearsal_failure
SELECT 'kept.user_features.changed', 'a surviving feature keeps enabled and updated_at', string_agg(r.key, ', ')
FROM rehearsal_rows r
JOIN user_features f ON f.owner || '|' || f.feature = r.key
WHERE r.class = 'user_features' AND to_jsonb(f) IS DISTINCT FROM r.payload
GROUP BY () HAVING count(*) > 0;

INSERT INTO rehearsal_failure
SELECT 'kept.user_features.removed_unexpected', 'only interactive-artifacts goes', string_agg(r.key, ', ')
FROM rehearsal_rows r
WHERE r.class = 'user_features'
  AND r.payload ->> 'feature' <> 'interactive-artifacts'
  AND NOT EXISTS (SELECT 1 FROM user_features f WHERE f.owner || '|' || f.feature = r.key)
GROUP BY () HAVING count(*) > 0;

-- Shapes the migrations leave behind that a count cannot state.
INSERT INTO rehearsal_failure
SELECT e.name, e.expected::text, e.actual::text
FROM (VALUES
  ('shape.connections.parents', 36, (SELECT count(*) FROM connections WHERE is_parent)),
  ('shape.connections.children', 33, (SELECT count(*) FROM connections WHERE parent_id IS NOT NULL)),
  ('shape.connections.child_token_field_scoped', 28, (SELECT count(*) FROM connections WHERE parent_id IS NOT NULL AND auth -> 'accessTokenRef' ->> 'field' = 'scoped_token')),
  ('shape.connections.parent_has_no_parent', 0, (SELECT count(*) FROM connections WHERE is_parent AND parent_id IS NOT NULL)),
  ('shape.connections.contributions_kept', 5, (SELECT count(*) FROM connections WHERE jsonb_array_length(contributions) > 0)),
  ('shape.invocation_runs', 5, (SELECT count(*) FROM invocation_runs)),
  ('shape.invocation_runs.started', 4, (SELECT count(*) FROM invocation_runs WHERE started_at IS NOT NULL)),
  ('shape.invocations.dropped_columns', 0, (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'invocations' AND column_name IN ('cpu', 'memory', 'prompt', 'result_schema', 'result',
       'script', 'exit_code', 'output', 'output_expires_at', 'status', 'error_reason', 'completed_at',
       'started_at', 'origin', 'awaited_until', 'claimed_until', 'delivered_at', 'woke_at'))),
  ('shape.invocations.keep_until', 1, (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'invocations' AND column_name = 'keep_until')),
  ('shape.environment_members', 0, (SELECT count(*) FROM environment_members)),
  ('shape.environments.expires_at_nullable', 1, (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'environments' AND column_name = 'expires_at' AND is_nullable = 'YES')),
  ('shape.spend_calls.stamped_session_id', 1, (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'spend_calls' AND column_name = 'stamped_session_id')),
  ('shape.spend_calls.stamped_default', 0, (SELECT count(*) FROM spend_calls WHERE stamped_session_id <> '')),
  ('shape.spend_calls.unbooked_idx', 1, (SELECT count(*) FROM pg_indexes WHERE indexname = 'spend_calls_unbooked_idx')),
  ('shape.satellites.incarnation_filled', 1, (SELECT count(*) FROM satellites WHERE incarnation IS NOT NULL)),
  ('shape.satellites.incarnation_distinct', 1, (SELECT count(DISTINCT incarnation) FROM satellites)),
  ('shape.attention_records.started_by', 1, (SELECT count(*) FROM attention_records WHERE started_by_sub IS NULL)),
  ('shape.control.agents.link_from', 1, (SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'control' AND table_name = 'agents' AND column_name = 'link_from')),
  ('shape.control.agents_guard.link_from', 1, (SELECT count(*) FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'control' AND p.proname = 'agents_guard' AND p.prosrc LIKE '%link_from%')),
  ('shape.control.controller_reads_grants', 1, (SELECT count(*) FROM (SELECT has_table_privilege(
     'platform_controller', 'control.agent_connection_grants', 'SELECT') AS ok) g WHERE ok)),
  ('shape.usage.usage_view_grants', 7, (SELECT count(*) FROM information_schema.role_table_grants
     WHERE grantee = 'usage_readers' AND table_name LIKE 'usage_src_%'))
) e(name, expected, actual)
WHERE e.actual IS DISTINCT FROM e.expected;

DO $$
DECLARE
  problems text;
BEGIN
  SELECT string_agg(format('%s: expected %s, got %s', name, expected, coalesce(actual, '(no detail)')), E'\n')
  INTO problems FROM rehearsal_failure;
  IF problems IS NOT NULL THEN
    RAISE EXCEPTION E'rehearsal assertions failed:\n%', problems;
  END IF;
END $$;
