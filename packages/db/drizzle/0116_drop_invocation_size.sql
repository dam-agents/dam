-- An Invocation's target has no CPU or memory size of its own: it shares its
-- owner's pool, and nothing has written these columns since the size left the
-- API. A release older than that one names both in its insert, so a rollback
-- reaching back past it fails every spawn; a rollback of one release does not.
ALTER TABLE "invocations" DROP COLUMN "cpu";--> statement-breakpoint
ALTER TABLE "invocations" DROP COLUMN "memory";
