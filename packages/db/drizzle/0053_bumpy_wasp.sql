-- A cancellation is dispatched at most once per lease: clearing the request on
-- handover loses it if the poll response never arrives, and leaving it set
-- re-sends the same work item on every poll.
ALTER TABLE "satellite_jobs" ADD COLUMN "cancel_sent_at" timestamp with time zone;