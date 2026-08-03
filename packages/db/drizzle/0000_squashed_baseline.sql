-- Squashed baseline — generated table/index/enum DDL from schema.ts (issue
-- #739, ADR-063), collapsing the original migrations 0000-0022. The usage_*
-- reporting views are a separate hand-written migration (0001_usage_views.sql).
--
-- Existing deployments DO NOT run this file: the migrator gates each migration
-- on its journal `when`, and this entry's `when` predates every migration they
-- have recorded, so it is treated as already-applied. Only fresh installs
-- (empty __drizzle_migrations) execute it.

CREATE TYPE "public"."activity_outcome" AS ENUM('success', 'failure');--> statement-breakpoint
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
CREATE TABLE "actor_roles" (
	"actor_sub" text PRIMARY KEY NOT NULL,
	"is_core" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_skill_publishes" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"skill_name" text NOT NULL,
	"source_id" text NOT NULL,
	"source_name" text NOT NULL,
	"source_git_url" text NOT NULL,
	"pr_url" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE "connection_grants" (
	"connection_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connection_grants_connection_id_agent_id_pk" PRIMARY KEY("connection_id","agent_id")
);
--> statement-breakpoint
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
CREATE TABLE "identity_links" (
	"provider" text NOT NULL,
	"external_user_id" text NOT NULL,
	"keycloak_sub" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
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
CREATE TABLE "runtime_state_outbox" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"version" bigint DEFAULT 0 NOT NULL,
	"last_enqueued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_settled_version" bigint DEFAULT 0 NOT NULL,
	"last_applied_version" bigint DEFAULT 0 NOT NULL,
	"last_applied_hash" text,
	"last_applied_at" timestamp with time zone,
	"apply_failures" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"apply_attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE "skill_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"git_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
CREATE INDEX "activity_events_type_occurred_idx" ON "activity_events" USING btree ("type","occurred_at");--> statement-breakpoint
CREATE INDEX "activity_events_actor_occurred_idx" ON "activity_events" USING btree ("actor_sub","occurred_at") WHERE "activity_events"."actor_sub" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "activity_events_surface_occurred_idx" ON "activity_events" USING btree ("surface","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_events_auth_dedup_idx" ON "activity_events" USING btree ("actor_sub","surface",date_trunc('day', "occurred_at" AT TIME ZONE 'UTC')) WHERE "activity_events"."type" = 'auth';--> statement-breakpoint
CREATE INDEX "agent_skill_publishes_agent_idx" ON "agent_skill_publishes" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_skills_agent_idx" ON "agent_skills" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agents_owner_idx" ON "agents" USING btree ("owner_sub");--> statement-breakpoint
CREATE UNIQUE INDEX "channels_agent_type_idx" ON "channels" USING btree ("agent_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "channels_slack_channel_unique_idx" ON "channels" USING btree (("config"->>'slackChannelId')) WHERE "channels"."type" = 'slack';--> statement-breakpoint
CREATE INDEX "connection_grants_agent_idx" ON "connection_grants" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "connections_owner_idx" ON "connections" USING btree ("owner");--> statement-breakpoint
CREATE UNIQUE INDEX "connections_owner_name_unique_idx" ON "connections" USING btree ("owner","name");--> statement-breakpoint
CREATE UNIQUE INDEX "egress_rules_lookup_idx" ON "egress_rules" USING btree ("agent_id","host","method","path_pattern") WHERE "egress_rules"."status" = 'active';--> statement-breakpoint
CREATE INDEX "egress_rules_source_idx" ON "egress_rules" USING btree ("source") WHERE "egress_rules"."status" = 'active' AND "egress_rules"."source" != 'manual';--> statement-breakpoint
CREATE INDEX "pending_approvals_owner_status_idx" ON "pending_approvals" USING btree ("owner_sub","status");--> statement-breakpoint
CREATE INDEX "pending_approvals_agent_status_idx" ON "pending_approvals" USING btree ("agent_id","status");--> statement-breakpoint
CREATE INDEX "pending_approvals_undelivered_idx" ON "pending_approvals" USING btree ("resolved_at") WHERE status = 'resolved' AND delivered_at IS NULL;--> statement-breakpoint
CREATE INDEX "runtime_events_agent_pending_idx" ON "runtime_events" USING btree ("agent_id","version") WHERE "runtime_events"."dispatched_at" IS NULL;--> statement-breakpoint
CREATE INDEX "runtime_events_expiry_idx" ON "runtime_events" USING btree ("expires_at") WHERE "runtime_events"."dispatched_at" IS NULL;--> statement-breakpoint
CREATE INDEX "runtime_state_outbox_retry_idx" ON "runtime_state_outbox" USING btree ("apply_attempts") WHERE "runtime_state_outbox"."apply_failures" <> '[]'::jsonb OR "runtime_state_outbox"."last_settled_version" < "runtime_state_outbox"."version";--> statement-breakpoint
CREATE INDEX "schedules_agent_owner_idx" ON "schedules" USING btree ("agent_id","owner");--> statement-breakpoint
CREATE INDEX "schedules_enabled_idx" ON "schedules" USING btree ("id") WHERE "schedules"."enabled" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "skill_sources_owner_git_url_idx" ON "skill_sources" USING btree ("owner","git_url");--> statement-breakpoint
CREATE INDEX "skill_sources_owner_idx" ON "skill_sources" USING btree ("owner");
