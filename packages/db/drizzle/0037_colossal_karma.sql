ALTER TABLE "runtime_events" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "runtime_events" ADD COLUMN "error" text;