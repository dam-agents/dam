-- A live wait owns the outcome it is blocking on: it renews this lease on every
-- poll, and the wake delivery skips a Job whose lease has not lapsed, so one
-- outcome reaches the Agent once. A waiter that dies stops renewing and the
-- delivery picks the outcome up on the next lap.
ALTER TABLE "satellite_jobs" ADD COLUMN "awaited_until" timestamp with time zone;
