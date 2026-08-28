ALTER TABLE "library_artifacts" ADD COLUMN "own_session" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "library_artifacts" ADD COLUMN "session_id" text;