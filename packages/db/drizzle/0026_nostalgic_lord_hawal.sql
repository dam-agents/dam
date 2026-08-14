-- Collapse relay attaches to one row per actor/agent/relay-kind/day.
--
-- The browser's ACP relay reconnects on a fixed short interval, and every
-- reconnect is a fresh admission, so the raw stream counts websocket
-- handshakes rather than people opening a chat. Observed on a live install:
-- 212 attach rows against 14 turns from a single session, roughly 18 rows a
-- minute per open tab, against 180-day retention. That drowns every other
-- signal in the table and makes the count unreadable.
--
-- Same remedy the auth rows already use: a partial unique index, with the
-- repository's existing ON CONFLICT DO NOTHING turning the duplicates into
-- no-ops. The surviving row keeps who, which agent, which relay kind and
-- which day — which is what "did this person use chat or the terminal on
-- this agent" needs. Only the reconnect count is lost, and it never meant
-- anything.
--
-- Existing duplicates must go first: CREATE UNIQUE INDEX fails outright on a
-- table that already violates it, and migrations run on api-server startup,
-- so leaving them would refuse to boot. The delete keeps the earliest row of
-- each group, ordered by (occurred_at, id) so ties resolve deterministically.
-- It uses `=` rather than IS NOT DISTINCT FROM to match the index exactly:
-- Postgres treats NULLs as distinct, so NULL-keyed rows are not duplicates
-- and must not be swept.

DELETE FROM activity_events a
USING activity_events b
WHERE a.type = 'relay_attached'
  AND b.type = 'relay_attached'
  AND a.actor_sub = b.actor_sub
  AND a.agent_id = b.agent_id
  AND (a.payload ->> 'relay') = (b.payload ->> 'relay')
  AND date_trunc('day', a.occurred_at AT TIME ZONE 'UTC')
    = date_trunc('day', b.occurred_at AT TIME ZONE 'UTC')
  AND (a.occurred_at, a.id) > (b.occurred_at, b.id);
--> statement-breakpoint
CREATE UNIQUE INDEX "activity_events_relay_dedup_idx" ON "activity_events" USING btree ("actor_sub","agent_id",("payload" ->> 'relay'),date_trunc('day', "occurred_at" AT TIME ZONE 'UTC')) WHERE "activity_events"."type" = 'relay_attached';
