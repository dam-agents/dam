-- Squashed baseline (issue #739, ADR-063). Reproduces the schema the 0000–0022
-- history produced, including the usage_* views. Keeps the original 0000 journal
-- timestamp so existing databases skip it and only fresh installs run it.

CREATE TYPE "public"."activity_outcome" AS ENUM ('success', 'failure');--> statement-breakpoint

CREATE TABLE "activity_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"actor_sub" text,
	"agent_id" text,
	"surface" text,
	"outcome" "activity_outcome" NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "activity_events_type_occurred_idx" ON "activity_events" USING btree ("type","occurred_at");--> statement-breakpoint
CREATE INDEX "activity_events_actor_occurred_idx" ON "activity_events" USING btree ("actor_sub","occurred_at") WHERE "actor_sub" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "activity_events_surface_occurred_idx" ON "activity_events" USING btree ("surface","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_events_auth_dedup_idx" ON "activity_events" USING btree ("actor_sub","surface",date_trunc('day', "occurred_at" AT TIME ZONE 'UTC')) WHERE "type" = 'auth';--> statement-breakpoint

CREATE TABLE "actor_roles" (
	"actor_sub" text PRIMARY KEY NOT NULL,
	"is_core" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE "agent_skill_publishes" (
	"id" text NOT NULL,
	"agent_id" text NOT NULL,
	"skill_name" text NOT NULL,
	"source_id" text NOT NULL,
	"source_name" text NOT NULL,
	"source_git_url" text NOT NULL,
	"pr_url" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instance_skill_publishes_pkey" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE INDEX "agent_skill_publishes_agent_idx" ON "agent_skill_publishes" USING btree ("agent_id");--> statement-breakpoint

CREATE TABLE "agent_skills" (
	"agent_id" text NOT NULL,
	"source" text NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"content_hash" text,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_skills_agent_id_source_name_pk" PRIMARY KEY("agent_id","source","name")
);
--> statement-breakpoint
CREATE INDEX "agent_skills_agent_idx" ON "agent_skills" USING btree ("agent_id");--> statement-breakpoint

CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_sub" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"runtime_protocol_version" text,
	"runtime_capabilities" jsonb,
	"runtime_last_hello_at" timestamp with time zone,
	"runtime_agent_version" text
);
--> statement-breakpoint
CREATE INDEX "agents_owner_idx" ON "agents" USING btree ("owner_sub");--> statement-breakpoint

CREATE TABLE "allowed_users" (
	"agent_id" text NOT NULL,
	"owner" text NOT NULL,
	"keycloak_sub" text NOT NULL,
	CONSTRAINT "allowed_users_agent_id_keycloak_sub_pk" PRIMARY KEY("agent_id","keycloak_sub")
);
--> statement-breakpoint

CREATE TABLE "channels" (
	"agent_id" text NOT NULL,
	"owner" text NOT NULL,
	"type" text NOT NULL,
	"config" jsonb NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "channels_agent_type_idx" ON "channels" USING btree ("agent_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "channels_slack_channel_unique_idx" ON "channels" USING btree (("config"->>'slackChannelId')) WHERE "type" = 'slack';--> statement-breakpoint

CREATE TABLE "connection_grants" (
	"connection_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connection_grants_connection_id_agent_id_pk" PRIMARY KEY("connection_id","agent_id")
);
--> statement-breakpoint
CREATE INDEX "connection_grants_agent_idx" ON "connection_grants" USING btree ("agent_id");--> statement-breakpoint

CREATE TABLE "connections" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"template_id" text NOT NULL,
	"name" text NOT NULL,
	"inputs" jsonb NOT NULL,
	"auth" jsonb NOT NULL,
	"contributions" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "connections_owner_idx" ON "connections" USING btree ("owner");--> statement-breakpoint
CREATE UNIQUE INDEX "connections_owner_name_unique_idx" ON "connections" USING btree ("owner","name");--> statement-breakpoint

CREATE TABLE "egress_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"host" text NOT NULL,
	"method" text NOT NULL,
	"path_pattern" text NOT NULL,
	"verdict" text NOT NULL,
	"decided_by" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "egress_rules_lookup_idx" ON "egress_rules" USING btree ("agent_id","host","method","path_pattern") WHERE "status" = 'active';--> statement-breakpoint
CREATE INDEX "egress_rules_source_idx" ON "egress_rules" USING btree ("source") WHERE "status" = 'active' AND "source" != 'manual';--> statement-breakpoint

CREATE TABLE "identity_links" (
	"external_user_id" text NOT NULL,
	"keycloak_sub" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider" text NOT NULL,
	CONSTRAINT "identity_links_provider_external_user_id_pk" PRIMARY KEY("provider","external_user_id")
);
--> statement-breakpoint

CREATE TABLE "pending_approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"agent_id" text NOT NULL,
	"owner_sub" text NOT NULL,
	"session_id" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"verdict" text,
	"decided_by" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "pending_approvals_owner_status_idx" ON "pending_approvals" USING btree ("owner_sub","status");--> statement-breakpoint
CREATE INDEX "pending_approvals_agent_status_idx" ON "pending_approvals" USING btree ("agent_id","status");--> statement-breakpoint
CREATE INDEX "pending_approvals_undelivered_idx" ON "pending_approvals" USING btree ("resolved_at") WHERE status = 'resolved' AND delivered_at IS NULL;--> statement-breakpoint

CREATE TABLE "runtime_events" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"version" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"dispatched_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "runtime_events_agent_pending_idx" ON "runtime_events" USING btree ("agent_id","version") WHERE "dispatched_at" IS NULL;--> statement-breakpoint
CREATE INDEX "runtime_events_expiry_idx" ON "runtime_events" USING btree ("expires_at") WHERE "dispatched_at" IS NULL;--> statement-breakpoint

CREATE TABLE "runtime_state_outbox" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"version" bigint DEFAULT 0 NOT NULL,
	"last_enqueued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_applied_version" bigint DEFAULT 0 NOT NULL,
	"last_applied_hash" text,
	"last_applied_at" timestamp with time zone,
	"last_settled_version" bigint DEFAULT 0 NOT NULL,
	"apply_failures" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"apply_attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "runtime_state_outbox_retry_idx" ON "runtime_state_outbox" USING btree ("apply_attempts") WHERE "apply_failures" <> '[]'::jsonb OR "last_settled_version" < "version";--> statement-breakpoint

CREATE TABLE "schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"spec" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"next_run" timestamp with time zone,
	"last_fired_at" timestamp with time zone,
	"last_fired_result" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "schedules_agent_owner_idx" ON "schedules" USING btree ("agent_id","owner");--> statement-breakpoint
CREATE INDEX "schedules_enabled_idx" ON "schedules" USING btree ("id") WHERE "enabled" = true;--> statement-breakpoint

CREATE TABLE "skill_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"git_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "skill_sources_owner_git_url_idx" ON "skill_sources" USING btree ("owner","git_url");--> statement-breakpoint
CREATE INDEX "skill_sources_owner_idx" ON "skill_sources" USING btree ("owner");--> statement-breakpoint

CREATE TABLE "telegram_threads" (
	"agent_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"authorized_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_threads_agent_id_thread_id_pk" PRIMARY KEY("agent_id","thread_id")
);
--> statement-breakpoint

CREATE TABLE "terms_acceptances" (
	"sub" text NOT NULL,
	"version" text NOT NULL,
	"hash" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "terms_acceptances_sub_version_pk" PRIMARY KEY("sub","version")
);
--> statement-breakpoint

CREATE VIEW "usage_core_actor_subs" AS
  SELECT actor_sub
  FROM actor_roles
  WHERE is_core = true;
--> statement-breakpoint
CREATE VIEW "usage_core_agents" AS
  SELECT DISTINCT a.id AS agent_id
  FROM agents a
  JOIN usage_core_actor_subs cs ON cs.actor_sub = a.owner_sub;
--> statement-breakpoint

CREATE VIEW "usage_auth_users_7d" AS
  SELECT
    actor_sub,
    MIN(occurred_at) AS first_seen,
    MAX(occurred_at) AS last_seen,
    COUNT(*) AS auth_events
  FROM activity_events
  WHERE type = 'auth'
    AND occurred_at >= NOW() - INTERVAL '7 days'
    AND actor_sub IS NOT NULL
    AND actor_sub NOT IN (SELECT actor_sub FROM usage_core_actor_subs)
  GROUP BY actor_sub;
--> statement-breakpoint
CREATE VIEW "usage_auth_surface_by_user" AS
  SELECT
    actor_sub,
    surface,
    COUNT(*) AS auth_count,
    MAX(occurred_at) AS last_seen
  FROM activity_events
  WHERE type = 'auth'
    AND actor_sub IS NOT NULL
    AND actor_sub NOT IN (SELECT actor_sub FROM usage_core_actor_subs)
  GROUP BY actor_sub, surface;
--> statement-breakpoint
CREATE VIEW "usage_auth_by_source_7d" AS
  SELECT
    surface,
    COUNT(*) AS auth_events
  FROM activity_events
  WHERE type = 'auth'
    AND occurred_at >= NOW() - INTERVAL '7 days'
    AND actor_sub NOT IN (SELECT actor_sub FROM usage_core_actor_subs)
  GROUP BY surface
  ORDER BY auth_events DESC;
--> statement-breakpoint
CREATE VIEW "usage_auth_by_source_day_7d" AS
  SELECT
    date_trunc('day', occurred_at AT TIME ZONE 'UTC')::date AS day,
    surface,
    COUNT(*) AS auth_events
  FROM activity_events
  WHERE type = 'auth'
    AND occurred_at >= NOW() - INTERVAL '7 days'
    AND actor_sub NOT IN (SELECT actor_sub FROM usage_core_actor_subs)
  GROUP BY day, surface
  ORDER BY day DESC, surface;
--> statement-breakpoint
CREATE VIEW "usage_multi_surface_users" AS
  SELECT
    actor_sub,
    array_agg(DISTINCT surface ORDER BY surface) AS surfaces,
    COUNT(DISTINCT surface) AS surface_count,
    COUNT(*) AS auth_events_total,
    MAX(occurred_at) AS last_seen
  FROM activity_events
  WHERE type = 'auth'
    AND actor_sub IS NOT NULL
    AND actor_sub NOT IN (SELECT actor_sub FROM usage_core_actor_subs)
  GROUP BY actor_sub
  HAVING COUNT(DISTINCT surface) > 1
  ORDER BY surface_count DESC, auth_events_total DESC;
--> statement-breakpoint
CREATE VIEW "usage_distinct_users_per_day_7d" AS
  SELECT
    date_trunc('day', occurred_at AT TIME ZONE 'UTC')::date AS day,
    COUNT(DISTINCT actor_sub) AS distinct_users
  FROM activity_events
  WHERE type = 'auth'
    AND occurred_at >= NOW() - INTERVAL '7 days'
    AND actor_sub IS NOT NULL
    AND actor_sub NOT IN (SELECT actor_sub FROM usage_core_actor_subs)
  GROUP BY day
  ORDER BY day DESC;
--> statement-breakpoint

CREATE VIEW "usage_channel_turns_by_agent" AS
  SELECT
    agent_id,
    surface AS channel,
    COUNT(*) AS turn_count,
    COUNT(*) FILTER (WHERE outcome = 'success') AS success_count,
    COUNT(*) FILTER (WHERE outcome = 'failure') AS failure_count,
    MAX(occurred_at) AS last_turn
  FROM activity_events
  WHERE type = 'channel_turn'
    AND agent_id NOT IN (SELECT agent_id FROM usage_core_agents)
  GROUP BY agent_id, surface;
--> statement-breakpoint
CREATE VIEW "usage_channel_turns_by_day_7d" AS
  SELECT
    date_trunc('day', occurred_at AT TIME ZONE 'UTC')::date AS day,
    surface AS channel,
    COUNT(*) AS turn_count,
    COUNT(*) FILTER (WHERE outcome = 'success') AS success_count,
    COUNT(*) FILTER (WHERE outcome = 'failure') AS failure_count
  FROM activity_events
  WHERE type = 'channel_turn'
    AND occurred_at >= NOW() - INTERVAL '7 days'
    AND agent_id NOT IN (SELECT agent_id FROM usage_core_agents)
  GROUP BY day, surface
  ORDER BY day DESC, channel;
--> statement-breakpoint
CREATE VIEW "usage_channel_top_agents_30d" AS
  SELECT
    agent_id,
    surface AS channel,
    COUNT(*) AS turn_count,
    COUNT(*) FILTER (WHERE outcome = 'success') AS success_count,
    COUNT(*) FILTER (WHERE outcome = 'failure') AS failure_count,
    MAX(occurred_at) AS last_turn
  FROM activity_events
  WHERE type = 'channel_turn'
    AND occurred_at >= NOW() - INTERVAL '30 days'
    AND agent_id IS NOT NULL
    AND agent_id NOT IN (SELECT agent_id FROM usage_core_agents)
  GROUP BY agent_id, surface
  ORDER BY turn_count DESC;
--> statement-breakpoint

CREATE VIEW "usage_schedule_fires_by_schedule" AS
  SELECT
    (payload->>'scheduleId') AS schedule_id,
    agent_id,
    COUNT(*) AS fire_count,
    COUNT(*) FILTER (WHERE outcome = 'success') AS success_count,
    COUNT(*) FILTER (WHERE outcome = 'failure') AS failure_count,
    MIN(occurred_at) AS first_fire,
    MAX(occurred_at) AS last_fire
  FROM activity_events
  WHERE type = 'schedule_fire'
    AND agent_id NOT IN (SELECT agent_id FROM usage_core_agents)
  GROUP BY schedule_id, agent_id
  ORDER BY fire_count DESC;
--> statement-breakpoint
CREATE VIEW "usage_schedule_fires_by_agent" AS
  SELECT
    agent_id,
    COUNT(*) AS fire_count,
    COUNT(*) FILTER (WHERE outcome = 'success') AS success_count,
    COUNT(*) FILTER (WHERE outcome = 'failure') AS failure_count,
    COUNT(DISTINCT (payload->>'scheduleId')) AS schedule_count,
    MIN(occurred_at) AS first_fire,
    MAX(occurred_at) AS last_fire
  FROM activity_events
  WHERE type = 'schedule_fire'
    AND agent_id NOT IN (SELECT agent_id FROM usage_core_agents)
  GROUP BY agent_id
  ORDER BY fire_count DESC;
--> statement-breakpoint

CREATE VIEW "usage_approvals_summary_30d" AS
  SELECT
    type,
    status,
    COALESCE(verdict, '-') AS verdict,
    COUNT(*) AS approval_count
  FROM pending_approvals
  WHERE created_at >= NOW() - INTERVAL '30 days'
    AND owner_sub NOT IN (SELECT actor_sub FROM usage_core_actor_subs)
  GROUP BY type, status, verdict
  ORDER BY approval_count DESC;
--> statement-breakpoint

CREATE VIEW "usage_skill_installs_by_skill" AS
  SELECT
    source,
    name,
    COUNT(DISTINCT agent_id) AS agent_count,
    MIN(installed_at) AS first_install,
    MAX(installed_at) AS last_install
  FROM agent_skills
  WHERE agent_id NOT IN (SELECT agent_id FROM usage_core_agents)
  GROUP BY source, name
  ORDER BY agent_count DESC;
--> statement-breakpoint
CREATE VIEW "usage_skill_installs_by_user" AS
  SELECT
    ss.owner,
    COUNT(*) AS install_count,
    COUNT(DISTINCT as_.name) AS distinct_skills
  FROM agent_skills as_
  JOIN skill_sources ss ON ss.git_url = as_.source
  WHERE as_.agent_id NOT IN (SELECT agent_id FROM usage_core_agents)
  GROUP BY ss.owner
  ORDER BY install_count DESC;
--> statement-breakpoint

CREATE VIEW "usage_egress_hosts_by_agent" AS
  SELECT
    agent_id,
    COUNT(DISTINCT host) AS distinct_hosts,
    COUNT(*) FILTER (WHERE status = 'active') AS active_rules,
    COUNT(*) FILTER (WHERE verdict = 'allow') AS allow_rules,
    COUNT(*) FILTER (WHERE verdict = 'deny') AS deny_rules
  FROM egress_rules
  GROUP BY agent_id
  ORDER BY distinct_hosts DESC;
--> statement-breakpoint

CREATE VIEW "usage_connections_by_user" AS
  SELECT
    actor_sub,
    array_agg(DISTINCT payload->>'connectionKey' ORDER BY payload->>'connectionKey') AS connection_keys,
    COUNT(DISTINCT payload->>'connectionKey') AS distinct_connection_count,
    MIN(occurred_at) AS first_connected,
    MAX(occurred_at) AS last_connected
  FROM activity_events
  WHERE type = 'connection_added'
    AND actor_sub IS NOT NULL
    AND actor_sub NOT IN (SELECT actor_sub FROM usage_core_actor_subs)
  GROUP BY actor_sub
  ORDER BY distinct_connection_count DESC;
--> statement-breakpoint
CREATE VIEW "usage_connections_by_key" AS
  SELECT
    payload->>'connectionKey' AS connection_key,
    surface AS kind,
    COUNT(DISTINCT actor_sub) AS distinct_users,
    COUNT(*) AS grant_count,
    MAX(occurred_at) AS last_connected
  FROM activity_events
  WHERE type = 'connection_added'
    AND actor_sub IS NOT NULL
    AND actor_sub NOT IN (SELECT actor_sub FROM usage_core_actor_subs)
  GROUP BY connection_key, kind
  ORDER BY distinct_users DESC;
--> statement-breakpoint
CREATE VIEW "usage_connection_churn_by_user" AS
  SELECT
    actor_sub,
    COUNT(*) FILTER (WHERE type = 'connection_added') AS adds,
    COUNT(*) FILTER (WHERE type = 'connection_removed') AS removes,
    COUNT(DISTINCT payload->>'connectionKey') FILTER (WHERE type = 'connection_added') AS distinct_added,
    COUNT(DISTINCT payload->>'connectionKey') FILTER (WHERE type = 'connection_removed') AS distinct_removed
  FROM activity_events
  WHERE type IN ('connection_added', 'connection_removed')
    AND actor_sub IS NOT NULL
    AND actor_sub NOT IN (SELECT actor_sub FROM usage_core_actor_subs)
  GROUP BY actor_sub
  ORDER BY adds DESC;
--> statement-breakpoint

CREATE VIEW "usage_imports_by_agent" AS
  SELECT
    agent_id,
    COUNT(*) AS import_count,
    COUNT(*) FILTER (WHERE outcome = 'success') AS success_count,
    COUNT(*) FILTER (WHERE outcome = 'failure') AS failure_count,
    SUM((payload->>'bytes')::bigint) FILTER (WHERE outcome = 'success') AS bytes_total,
    MAX(occurred_at) AS last_import
  FROM activity_events
  WHERE type = 'files_imported'
    AND agent_id NOT IN (SELECT agent_id FROM usage_core_agents)
  GROUP BY agent_id
  ORDER BY import_count DESC;
--> statement-breakpoint
CREATE VIEW "usage_imports_by_user" AS
  SELECT
    actor_sub,
    COUNT(*) AS import_count,
    COUNT(*) FILTER (WHERE outcome = 'success') AS success_count,
    COUNT(*) FILTER (WHERE outcome = 'failure') AS failure_count,
    MIN(occurred_at) AS first_import,
    MAX(occurred_at) AS last_import
  FROM activity_events
  WHERE type = 'files_imported'
    AND actor_sub IS NOT NULL
    AND actor_sub NOT IN (SELECT actor_sub FROM usage_core_actor_subs)
  GROUP BY actor_sub
  ORDER BY import_count DESC;
--> statement-breakpoint
CREATE VIEW "usage_imports_by_day_7d" AS
  SELECT
    date_trunc('day', occurred_at AT TIME ZONE 'UTC')::date AS day,
    COUNT(*) AS import_count,
    COUNT(*) FILTER (WHERE outcome = 'success') AS success_count,
    COUNT(*) FILTER (WHERE outcome = 'failure') AS failure_count
  FROM activity_events
  WHERE type = 'files_imported'
    AND occurred_at >= NOW() - INTERVAL '7 days'
    AND agent_id NOT IN (SELECT agent_id FROM usage_core_agents)
  GROUP BY day
  ORDER BY day DESC;
