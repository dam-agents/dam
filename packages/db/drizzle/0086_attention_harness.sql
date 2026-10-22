-- The sidebar shows which harness ran a session, also for an Agent that is
-- asleep. A hibernated Agent cannot be asked for it, so the attention record
-- keeps it.
ALTER TABLE "attention_records" ADD COLUMN "harness" text;
