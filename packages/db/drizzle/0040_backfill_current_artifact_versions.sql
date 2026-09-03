-- Every artifact now keeps a version row for the version it is at, so the
-- version list, content lookup and delete no longer special-case the current
-- one. Rows written before that change start at the first superseded version,
-- so give each artifact the row for its current version.
INSERT INTO library_artifact_versions
  (artifact_id, version, storage_ref, content_type, size_bytes, created_at)
SELECT id, version, storage_ref, content_type, size_bytes, updated_at
FROM library_artifacts
ON CONFLICT (artifact_id, version) DO NOTHING;
