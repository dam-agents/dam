-- ADR-046: Eliminate Instance — collapse into Agent.
--
-- Data-preserving schema migration. Each row's `instance_id` becomes
-- `agent_id`. The IDs themselves are preserved verbatim — the companion
-- K8s pre-upgrade Job (`migrate-fold-instances.yaml`) folds each
-- `agent-platform.ai/type=agent-instance` ConfigMap into a single
-- `type=agent` CM at the instance's name, so existing Postgres FKs still
-- resolve. Legacy agents keep their `inst-` prefix; new agents get
-- `agent-`. Mixed-prefix is cosmetic, not load-bearing.
--
-- Idempotent: every DROP CONSTRAINT / DROP INDEX uses IF EXISTS, every
-- RENAME COLUMN/TABLE will no-op if already applied (Postgres raises an
-- error on already-renamed, hence we gate with information_schema
-- lookups for the parts that aren't IF EXISTS-friendly).

-- ─── channels ───────────────────────────────────────────────────────
DROP INDEX IF EXISTS "channels_instance_type_idx";--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'channels' AND column_name = 'instance_id'
  ) THEN
    ALTER TABLE "channels" RENAME COLUMN "instance_id" TO "agent_id";
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channels_agent_type_idx" ON "channels" USING btree ("agent_id","type");--> statement-breakpoint

-- ─── allowed_users ──────────────────────────────────────────────────
ALTER TABLE "allowed_users" DROP CONSTRAINT IF EXISTS "allowed_users_instance_id_keycloak_sub_pk";--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'allowed_users' AND column_name = 'instance_id'
  ) THEN
    ALTER TABLE "allowed_users" RENAME COLUMN "instance_id" TO "agent_id";
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'allowed_users'
      AND constraint_name = 'allowed_users_agent_id_keycloak_sub_pk'
  ) THEN
    ALTER TABLE "allowed_users"
      ADD CONSTRAINT "allowed_users_agent_id_keycloak_sub_pk"
      PRIMARY KEY ("agent_id","keycloak_sub");
  END IF;
END $$;--> statement-breakpoint

-- ─── telegram_threads ───────────────────────────────────────────────
ALTER TABLE "telegram_threads" DROP CONSTRAINT IF EXISTS "telegram_threads_instance_id_thread_id_pk";--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'telegram_threads' AND column_name = 'instance_id'
  ) THEN
    ALTER TABLE "telegram_threads" RENAME COLUMN "instance_id" TO "agent_id";
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'telegram_threads'
      AND constraint_name = 'telegram_threads_agent_id_thread_id_pk'
  ) THEN
    ALTER TABLE "telegram_threads"
      ADD CONSTRAINT "telegram_threads_agent_id_thread_id_pk"
      PRIMARY KEY ("agent_id","thread_id");
  END IF;
END $$;--> statement-breakpoint

-- ─── pending_approvals: drop the redundant instance_id, agent_id is truth ─
DROP INDEX IF EXISTS "pending_approvals_instance_status_idx";--> statement-breakpoint
ALTER TABLE "pending_approvals" DROP COLUMN IF EXISTS "instance_id";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pending_approvals_agent_status_idx" ON "pending_approvals" USING btree ("agent_id","status");--> statement-breakpoint

-- ─── sessions ───────────────────────────────────────────────────────
DROP INDEX IF EXISTS "sessions_instance_thread_idx";--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sessions' AND column_name = 'instance_id'
  ) THEN
    ALTER TABLE "sessions" RENAME COLUMN "instance_id" TO "agent_id";
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sessions_agent_thread_idx" ON "sessions" USING btree ("agent_id","thread_ts") WHERE "sessions"."thread_ts" IS NOT NULL;--> statement-breakpoint

-- ─── instance_skills → agent_skills ─────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'instance_skills') THEN
    ALTER TABLE "instance_skills" RENAME TO "agent_skills";
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "agent_skills" DROP CONSTRAINT IF EXISTS "instance_skills_pkey";--> statement-breakpoint
DROP INDEX IF EXISTS "instance_skills_instance_idx";--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agent_skills' AND column_name = 'instance_id'
  ) THEN
    ALTER TABLE "agent_skills" RENAME COLUMN "instance_id" TO "agent_id";
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'agent_skills'
      AND constraint_name = 'agent_skills_agent_id_source_name_pk'
  ) THEN
    ALTER TABLE "agent_skills"
      ADD CONSTRAINT "agent_skills_agent_id_source_name_pk"
      PRIMARY KEY ("agent_id","source","name");
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_skills_agent_idx" ON "agent_skills" USING btree ("agent_id");--> statement-breakpoint

-- ─── instance_skill_publishes → agent_skill_publishes ───────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'instance_skill_publishes') THEN
    ALTER TABLE "instance_skill_publishes" RENAME TO "agent_skill_publishes";
  END IF;
END $$;--> statement-breakpoint
DROP INDEX IF EXISTS "instance_skill_publishes_instance_idx";--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agent_skill_publishes' AND column_name = 'instance_id'
  ) THEN
    ALTER TABLE "agent_skill_publishes" RENAME COLUMN "instance_id" TO "agent_id";
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_skill_publishes_agent_idx" ON "agent_skill_publishes" USING btree ("agent_id");
