-- The chat shows a running sub-agent only in the session that spawned it, so
-- the record keeps that session. Rows from before it, and spawns that came from
-- no known session, stay null and still show in every session of the driver.
ALTER TABLE "invocations" ADD COLUMN "driver_session_id" text;
