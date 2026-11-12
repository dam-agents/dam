-- A regular Agent no longer has an idle window of its own: every one sleeps on
-- the install's idle timeout, and nothing can set an override on it any more.
-- The overrides stored before that ("never sleeps" from the old UI field or a
-- starter kit, and custom windows) go, so those Agents sleep like the rest. An
-- Environment (environment_of) and a sub-agent (its id is an invocation's) keep
-- theirs: their own create and keep calls set them. The guard trigger bumps the
-- generation and the signals version, so the controller re-reads each row.
UPDATE "control"."agents" a
SET "hibernation_timeout_ns" = NULL, "updated_at" = now()
WHERE a."hibernation_timeout_ns" IS NOT NULL
  AND a."environment_of" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "invocations" i WHERE i."id" = a."id");
