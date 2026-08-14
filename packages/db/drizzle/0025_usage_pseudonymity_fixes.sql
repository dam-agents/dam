-- Two views read tables that store RAW Keycloak subs, and both got it wrong in
-- the same place: `activity_events`, `actor_roles` and `agents` hold
-- HMAC-pseudonymized subs, while `pending_approvals.owner_sub` and
-- `skill_sources.owner` hold raw ones — those tables are queried by the
-- caller's own sub at request time, so they cannot be hashed.
--
-- Mixing the two spaces fails silently in both directions:
--
--   * comparing a raw sub against the hashed core-team set never matches, so
--     the exclusion reads as "nobody is core" rather than erroring;
--   * selecting a raw sub emits a real Keycloak identifier into the inspector
--     report, which is precisely what the subsystem promises it does not do.
--
-- Both are fixed by keying on identifiers that live in ONE space: the agent id
-- (raw on both sides) and the agents mirror's owner (hashed on both sides).

-- ----------------------------------------------------------------------------
-- 1. Approvals — core-team exclusion was a silent no-op
--
-- `pending_approvals.owner_sub` is raw, so `owner_sub NOT IN (hashed core
-- subs)` was always true and core-team approvals were counted in a view whose
-- whole contract is that they are not. Filtering on the agent instead compares
-- raw agent ids on both sides, which is a space that actually matches.
-- ----------------------------------------------------------------------------

DROP VIEW IF EXISTS "usage_approvals_summary_30d";--> statement-breakpoint

CREATE VIEW "usage_approvals_summary_30d" AS
  SELECT
    type,
    status,
    COALESCE(verdict, '-') AS verdict,
    COUNT(*) AS approval_count
  FROM pending_approvals
  WHERE created_at >= NOW() - INTERVAL '30 days'
    AND agent_id NOT IN (SELECT agent_id FROM usage_core_agents)
  GROUP BY type, status, verdict
  ORDER BY approval_count DESC;
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 2. Skill installs by user — was emitting raw Keycloak subs
--
-- The old view grouped on `skill_sources.owner`, putting a raw sub in the
-- inspector's output. It also answered a different question than its name:
-- the owner of a source is whoever curated it, not whoever installed from it —
-- the original comment noted per-installer attribution "would require joining
-- to agents.owner_sub", which is exactly what this now does. That mirror's
-- owner is pseudonymized, so the fix removes the leak and corrects the
-- attribution at once, and the result joins with every other pilot view.
-- ----------------------------------------------------------------------------

DROP VIEW IF EXISTS "usage_skill_installs_by_user";--> statement-breakpoint

CREATE VIEW "usage_skill_installs_by_user" AS
  SELECT
    a.owner_sub AS actor_sub,
    COUNT(*) AS install_count,
    COUNT(DISTINCT s.name) AS distinct_skills,
    COUNT(DISTINCT s.source) AS distinct_sources
  FROM agent_skills s
  JOIN agents a ON a.id = s.agent_id
  WHERE s.agent_id NOT IN (SELECT agent_id FROM usage_core_agents)
  GROUP BY a.owner_sub
  ORDER BY install_count DESC;
