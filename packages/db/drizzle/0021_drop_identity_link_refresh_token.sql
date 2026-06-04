-- `identity_links.refresh_token` was written at `/login` but read by nobody:
-- per-turn impersonation (ADR-027) shipped as forks (ADR-033) keyed on
-- `keycloak_sub` + the replier's connection secrets, never this token. Drop the
-- column to close the ITSS Ch 1 §5.1 finding (dam-ops#11) by removing the
-- Confidential data outright, superseding the at-rest encryption in PR #292.
ALTER TABLE "identity_links" DROP COLUMN IF EXISTS "refresh_token";
