-- One row per count the rehearsal compares across the upgrade. Columns only a
-- post-upgrade schema has are asserted in upgrade-rehearsal-assert.sql instead,
-- so this file runs unchanged on both sides of the migration run.
-- The label comes from psql: `-v label=before`.
INSERT INTO rehearsal_snapshot (label, name, n)
SELECT :'label', name, n FROM (
  SELECT 'agents' AS name, count(*) AS n FROM agents
  UNION ALL SELECT 'connections', count(*) FROM connections
  UNION ALL SELECT 'connections.github_oauth_complete', count(*) FROM connections
    WHERE template_id = 'github' AND auth ->> 'kind' = 'oauth' AND auth ? 'connectedAt' AND auth ? 'expiresAt'
  UNION ALL SELECT 'connections.github_oauth_incomplete', count(*) FROM connections
    WHERE template_id = 'github' AND auth ->> 'kind' = 'oauth' AND NOT auth ? 'connectedAt' AND NOT auth ? 'expiresAt'
  UNION ALL SELECT 'connections.github_enterprise_oauth_complete', count(*) FROM connections
    WHERE template_id = 'github-enterprise' AND auth ->> 'kind' = 'oauth' AND auth ? 'connectedAt' AND auth ? 'expiresAt'
  UNION ALL SELECT 'connections.github_enterprise_oauth_incomplete', count(*) FROM connections
    WHERE template_id = 'github-enterprise' AND auth ->> 'kind' = 'oauth' AND NOT auth ? 'connectedAt' AND NOT auth ? 'expiresAt'
  UNION ALL SELECT 'connections.github_oauth_timestamps_json_null', count(*) FROM connections
    WHERE template_id = 'github' AND auth ->> 'kind' = 'oauth' AND auth -> 'connectedAt' = 'null'::jsonb
  UNION ALL SELECT 'connections.installations', count(*) FROM connections
    WHERE template_id IN ('github-app', 'github-enterprise-app') AND auth ->> 'kind' = 'github-app'
  UNION ALL SELECT 'connections.full_access', count(*) FROM connections WHERE auth ? 'fullAccess'
  UNION ALL SELECT 'connections.other_templates', count(*) FROM connections
    WHERE template_id NOT IN ('github', 'github-enterprise', 'github-app', 'github-enterprise-app')
  UNION ALL SELECT 'connection_grants', count(*) FROM connection_grants
  UNION ALL SELECT 'connection_grants.on_incomplete_github_signins', count(*)
    FROM connection_grants g JOIN connections c ON c.id = g.connection_id
    WHERE c.template_id IN ('github', 'github-enterprise') AND c.auth ->> 'kind' = 'oauth'
      AND NOT (c.auth ? 'connectedAt') AND NOT (c.auth ? 'expiresAt')
  UNION ALL SELECT 'runtime_state_outbox', count(*) FROM runtime_state_outbox
  UNION ALL SELECT 'runtime_state_outbox.version_sum', coalesce(sum(version), 0) FROM runtime_state_outbox
  UNION ALL SELECT 'invocations', count(*) FROM invocations
  UNION ALL SELECT 'user_features', count(*) FROM user_features
  UNION ALL SELECT 'user_features.interactive_artifacts', count(*) FROM user_features WHERE feature = 'interactive-artifacts'
  UNION ALL SELECT 'environment_access_lists', count(*) FROM environment_access_lists
  UNION ALL SELECT 'environment_access_lists.emails', coalesce(sum(jsonb_array_length(emails)), 0) FROM environment_access_lists
  UNION ALL SELECT 'environments', count(*) FROM environments
  UNION ALL SELECT 'spend_calls', count(*) FROM spend_calls
  UNION ALL SELECT 'spend_calls.unstamped', count(*) FROM spend_calls WHERE session_id = '' AND stamped_session_id <> ''
  UNION ALL SELECT 'satellites', count(*) FROM satellites
  UNION ALL SELECT 'attention_records', count(*) FROM attention_records
) s;
