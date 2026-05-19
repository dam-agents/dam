-- ADR-046: Eliminate Instance — collapse into Agent.
--
-- Clean-slate cutover. Existing rows reference Instance ConfigMaps that are
-- being deleted from the cluster, so all instance-keyed data is orphan by
-- definition; truncate and let the application recreate state against the
-- merged Agent. Approvals and egress rules already key on agent_id; their
-- rows are truncated too because the agents they pointed at are being
-- deleted as part of the same cutover.
TRUNCATE TABLE
  channels,
  allowed_users,
  telegram_threads,
  pending_approvals,
  sessions,
  instance_skills,
  instance_skill_publishes,
  egress_rules;
--> statement-breakpoint

-- channels
DROP INDEX IF EXISTS "channels_instance_type_idx";--> statement-breakpoint
ALTER TABLE "channels" RENAME COLUMN "instance_id" TO "agent_id";--> statement-breakpoint
CREATE UNIQUE INDEX "channels_agent_type_idx" ON "channels" USING btree ("agent_id","type");--> statement-breakpoint

-- allowed_users
ALTER TABLE "allowed_users" DROP CONSTRAINT IF EXISTS "allowed_users_instance_id_keycloak_sub_pk";--> statement-breakpoint
ALTER TABLE "allowed_users" RENAME COLUMN "instance_id" TO "agent_id";--> statement-breakpoint
ALTER TABLE "allowed_users" ADD CONSTRAINT "allowed_users_agent_id_keycloak_sub_pk" PRIMARY KEY ("agent_id","keycloak_sub");--> statement-breakpoint

-- telegram_threads
ALTER TABLE "telegram_threads" DROP CONSTRAINT IF EXISTS "telegram_threads_instance_id_thread_id_pk";--> statement-breakpoint
ALTER TABLE "telegram_threads" RENAME COLUMN "instance_id" TO "agent_id";--> statement-breakpoint
ALTER TABLE "telegram_threads" ADD CONSTRAINT "telegram_threads_agent_id_thread_id_pk" PRIMARY KEY ("agent_id","thread_id");--> statement-breakpoint

-- pending_approvals: drop the redundant instance_id column (agent_id is the truth)
DROP INDEX IF EXISTS "pending_approvals_instance_status_idx";--> statement-breakpoint
ALTER TABLE "pending_approvals" DROP COLUMN IF EXISTS "instance_id";--> statement-breakpoint
CREATE INDEX "pending_approvals_agent_status_idx" ON "pending_approvals" USING btree ("agent_id","status");--> statement-breakpoint

-- sessions
DROP INDEX IF EXISTS "sessions_instance_thread_idx";--> statement-breakpoint
ALTER TABLE "sessions" RENAME COLUMN "instance_id" TO "agent_id";--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_agent_thread_idx" ON "sessions" USING btree ("agent_id","thread_ts") WHERE "sessions"."thread_ts" IS NOT NULL;--> statement-breakpoint

-- instance_skills -> agent_skills
ALTER TABLE "instance_skills" RENAME TO "agent_skills";--> statement-breakpoint
ALTER TABLE "agent_skills" DROP CONSTRAINT IF EXISTS "instance_skills_pkey";--> statement-breakpoint
DROP INDEX IF EXISTS "instance_skills_instance_idx";--> statement-breakpoint
ALTER TABLE "agent_skills" RENAME COLUMN "instance_id" TO "agent_id";--> statement-breakpoint
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_agent_id_source_name_pk" PRIMARY KEY ("agent_id","source","name");--> statement-breakpoint
CREATE INDEX "agent_skills_agent_idx" ON "agent_skills" USING btree ("agent_id");--> statement-breakpoint

-- instance_skill_publishes -> agent_skill_publishes
ALTER TABLE "instance_skill_publishes" RENAME TO "agent_skill_publishes";--> statement-breakpoint
DROP INDEX IF EXISTS "instance_skill_publishes_instance_idx";--> statement-breakpoint
ALTER TABLE "agent_skill_publishes" RENAME COLUMN "instance_id" TO "agent_id";--> statement-breakpoint
CREATE INDEX "agent_skill_publishes_agent_idx" ON "agent_skill_publishes" USING btree ("agent_id");
