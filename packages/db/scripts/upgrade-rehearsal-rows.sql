-- Every row of every table a migration between the release and main rewrites,
-- as jsonb, before the upgrade runs. The assertions then compare the upgraded
-- tables against these payloads column for column, which is what catches a
-- migration that keeps the row counts and loses a name, an input, a
-- contribution or a Secret path.
--
-- One file for both sides of the upgrade: it reads only the release's schema,
-- so it runs once, before main's migrator. The rollback half runs it again on
-- the restored database under its own label.
-- The label comes from psql: `-v label=before`.
INSERT INTO rehearsal_rows (label, class, key, payload)
SELECT :'label', class, key, payload
FROM (
  SELECT 'connections' AS class, id AS key, to_jsonb(c) AS payload FROM connections c
  UNION ALL
  SELECT 'connection_grants', connection_id || '|' || agent_id, to_jsonb(g) FROM connection_grants g
  UNION ALL
  SELECT 'invocations', id, to_jsonb(i) FROM invocations i
  UNION ALL
  SELECT 'environment_access_lists', owning_agent_id, to_jsonb(l) FROM environment_access_lists l
  UNION ALL
  SELECT 'user_features', owner || '|' || feature, to_jsonb(f) FROM user_features f
  UNION ALL
  SELECT 'spend_calls', call_id, to_jsonb(s) FROM spend_calls s
  UNION ALL
  SELECT 'satellites', name, to_jsonb(s) FROM satellites s
  UNION ALL
  SELECT 'agents', id, to_jsonb(a) FROM agents a
  UNION ALL
  SELECT 'attention_records', agent_id || '|' || session_id || '|' || type, to_jsonb(r) FROM attention_records r
  UNION ALL
  SELECT 'environments', agent_id, to_jsonb(e) FROM environments e
) rows;
