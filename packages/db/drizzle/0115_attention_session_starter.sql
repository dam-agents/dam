-- Who started each Session (its Session Starter), copied from the Agent by the
-- session watcher, so Activity can name a person who is not the viewer while
-- the Agent sleeps. Null for a scheduled or channel Session, which has none.
ALTER TABLE "attention_records" ADD COLUMN "started_by_sub" text;--> statement-breakpoint
ALTER TABLE "attention_records" ADD COLUMN "started_by_email" text;