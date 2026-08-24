-- Source passthrough views for external usage analytics (#3269).
--
-- These views are the privacy boundary between the usage tables and a
-- read-only analytics consumer: each enumerates exactly the columns that may
-- leave its table. Aggregations live with the consumer, not here. They are
-- deliberately NOT registered in report-service.ts — they are not reportable
-- aggregates, and VIEW_NAMES stays the inspector-report surface.
--
-- Explicit column lists everywhere, deliberately: Postgres expands SELECT *
-- at CREATE time anyway, so a list is identical in behavior and keeps the
-- exposed contract readable in this file. A column added to a base table is
-- invisible through its passthrough until the view is recreated — recreate
-- the passthrough in the migration that adds the column.
--
-- What is exposed and what is not:
--   * activity_events / actor_roles / agents expose subs safely — the
--     repository boundary HMAC-pseudonymizes every sub before INSERT.
--   * pending_approvals.owner_sub, pending_approvals.decided_by,
--     egress_rules.decided_by and skill_sources.owner hold RAW Keycloak subs
--     (see 0025) — omitted.
--   * pending_approvals.payload and .session_id, agents.harness_config_snapshot
--     and .skills_snapshot are application data never written for analytics —
--     omitted until a metric actually needs a column from them.
--   * activity_events.payload passes through as an object, deliberately: the
--     consumer's metrics key on payload fields, and a new payload key must
--     reach it without a dam migration. The column contract therefore does
--     not extend inside the object; instead every key the emit sites write
--     (persist-activity.ts) has been audited into three classes:
--       - identity keys (externalActorId, ownerSub) — HMAC-pseudonymized
--         before INSERT at the repository boundary;
--       - user-authored identifiers (the skill events' name and source) —
--         validated only as short non-empty strings, but the same data this
--         contract already exposes as columns (agent_skills.name/.source,
--         skill_sources.git_url), and for Local Skills the event is the only
--         record of the name — so they pass through;
--       - everything else — bounded tokens or numbers, with one exception:
--         'message' (a raw driver error string on the contribution events)
--         is free-form prose and is stripped here.
--     A new payload key carrying free-form prose must be dropped at its emit
--     site or added to the strip list; a new user-authored identifier is
--     acceptable only where its data class is already an exposed column.

CREATE VIEW "usage_src_activity_events" AS
  SELECT id, type, actor_sub, agent_id, surface, outcome,
         payload - 'message' AS payload, occurred_at
  FROM activity_events;
--> statement-breakpoint
CREATE VIEW "usage_src_actor_roles" AS
  SELECT actor_sub, is_core, updated_at
  FROM actor_roles;
--> statement-breakpoint
CREATE VIEW "usage_src_agents" AS
  SELECT id, owner_sub, created_at, deleted_at, runtime_protocol_version,
         runtime_agent_version, runtime_capabilities, runtime_last_hello_at
  FROM agents;
--> statement-breakpoint
CREATE VIEW "usage_src_pending_approvals" AS
  SELECT id, type, agent_id, created_at, expires_at, resolved_at, verdict,
         status, delivered_at
  FROM pending_approvals;
--> statement-breakpoint
CREATE VIEW "usage_src_agent_skills" AS
  SELECT agent_id, source, name, version, content_hash, path, installed_at
  FROM agent_skills;
--> statement-breakpoint
CREATE VIEW "usage_src_skill_sources" AS
  SELECT id, name, git_url, path, created_at
  FROM skill_sources;
--> statement-breakpoint
CREATE VIEW "usage_src_egress_rules" AS
  SELECT id, agent_id, host, port, method, path_pattern, verdict, decided_at,
         status, source
  FROM egress_rules;
