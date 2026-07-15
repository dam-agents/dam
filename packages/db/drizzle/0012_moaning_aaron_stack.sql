-- Candidate artifacts moved to the S3-compatible object store (#2764); the
-- feature never shipped with inline-Postgres storage, so the table is dropped
-- rather than migrated.
DROP TABLE "run_artifacts" CASCADE;