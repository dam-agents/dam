-- Grant the source passthrough views to the usage_readers group role (#3269).
--
-- Privileges in Postgres attach to the object, not the name, so recreating a
-- view destroys every grant on it — and a passthrough must be recreated rather
-- than replaced whenever a column is renamed or reordered, which is exactly the
-- migration that changes what the analytics consumer reads. Granting that
-- consumer's own login directly therefore revoked its access on precisely the
-- deploys it needed to survive, silently until its next nightly run.
--
-- The grant goes to a group role instead: `usage_readers` is NOLOGIN and
-- password-less, so it is not a connection identity and confers nothing by
-- itself. An operator grants a read-only login MEMBERSHIP in it, and membership
-- is attached to the two roles rather than to any view, so no future migration
-- can revoke it.
--
-- This migration covers the passthroughs 0032 created. From here on, every
-- migration that creates or recreates a `usage_src_*` view must re-grant it in
-- the same file — enforced by `mise run db:check:usage-src-grants`, which fails
-- the build otherwise. The grants are spelled out one view at a time rather than
-- looped over a name pattern so that this file, and every migration after it,
-- says exactly which views the consumer can read.
--
-- Guarded on the role existing, because it usually does not. The chart creates
-- it only when it manages Postgres; on an external or managed instance an
-- operator creates it out-of-band, and on any install with no analytics
-- consumer it is absent for good. An unguarded GRANT would raise
-- `role "usage_readers" does not exist` and abort the whole migration, which
-- would crash-loop the api-server on exactly those installs.
--
-- Aggregate `usage_*` views are deliberately not granted. A consumer able to
-- read an aggregate would eventually key a metric on one, and renaming that
-- aggregate would break it — the coupling the passthrough surface exists to
-- remove. Withholding them leaves the passthrough column lists as the only
-- contract.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'usage_readers') THEN
    GRANT SELECT ON usage_src_activity_events  TO usage_readers;
    GRANT SELECT ON usage_src_actor_roles      TO usage_readers;
    GRANT SELECT ON usage_src_agents           TO usage_readers;
    GRANT SELECT ON usage_src_pending_approvals TO usage_readers;
    GRANT SELECT ON usage_src_agent_skills     TO usage_readers;
    GRANT SELECT ON usage_src_skill_sources    TO usage_readers;
    GRANT SELECT ON usage_src_egress_rules     TO usage_readers;
  END IF;
END $$;
