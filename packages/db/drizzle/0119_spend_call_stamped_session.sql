-- A call row whose Session the directory did not know when the call was
-- metered keeps the Session its stamp named, so a later pass can book the
-- call there once the agent's report of that Session arrives.
--
-- Both guards are load-bearing: an install that took the 0.2.24 backport
-- created this column and index under its own 0109, and the upgrade re-runs
-- this migration because only the journal's `when` decides. Do not remove
-- them, nor change the `when`.
ALTER TABLE "spend_calls" ADD COLUMN IF NOT EXISTS "stamped_session_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "spend_calls_unbooked_idx" ON "spend_calls" USING btree ("started_at") WHERE "spend_calls"."session_id" = '' AND "spend_calls"."stamped_session_id" <> '';
