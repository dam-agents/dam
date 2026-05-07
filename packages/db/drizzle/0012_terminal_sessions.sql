-- Two-phase add: enum type + nullable column, backfill, then NOT NULL.
-- No SQL DEFAULT — every caller must pass the mode explicitly so the
-- chat/terminal choice is visible in code, not implicit.
CREATE TYPE "session_mode" AS ENUM('chat', 'terminal');
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "mode" "session_mode";
--> statement-breakpoint
UPDATE "sessions" SET "mode" = 'chat' WHERE "mode" IS NULL;
--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "mode" SET NOT NULL;
