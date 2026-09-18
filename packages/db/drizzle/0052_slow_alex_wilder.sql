-- An outcome is claimed for delivery and woken separately: a wake that cannot
-- fire (an agent parked over budget) must stay findable by the retry sweep,
-- which a single delivered stamp would hide.
ALTER TABLE "satellite_jobs" ADD COLUMN "woke_at" timestamp with time zone;