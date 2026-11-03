-- A call row whose Session the directory did not know when the call was
-- metered keeps the Session its stamp named, so a later pass can book the
-- call there once the agent's report of that Session arrives.
ALTER TABLE "spend_calls" ADD COLUMN IF NOT EXISTS "stamped_session_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "spend_calls_unbooked_idx" ON "spend_calls" USING btree ("started_at") WHERE "spend_calls"."session_id" = '' AND "spend_calls"."stamped_session_id" <> '';
