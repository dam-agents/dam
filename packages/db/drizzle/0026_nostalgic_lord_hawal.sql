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
--
-- It ranks within each group rather than joining the table to itself. A
-- self-join enumerates every ordered pair inside a group, so cost grows with
-- the square of the group size — and a group is one user on one agent for one
-- day, which the reconnect loop can fill with thousands of rows. Measured on
-- postgres:16, a single 8,640-row group took 23 seconds that way and 63ms
-- this way. That matters beyond speed: Drizzle runs every pending migration
-- inside one transaction, awaited during startup, so a slow sweep is a boot
-- that a liveness probe kills and replays from the beginning.
--
-- The NOT NULL guards are load-bearing and are what keeps this equivalent to
-- the index. PARTITION BY groups NULLs together; a unique index treats them
-- as distinct. Without the guards this would delete exactly the rows the
-- index does not consider duplicates.

DELETE FROM activity_events
WHERE id IN (
  SELECT id
  FROM (
    SELECT
      id,
      row_number() OVER (
        PARTITION BY
          actor_sub,
          agent_id,
          payload ->> 'relay',
          date_trunc('day', occurred_at AT TIME ZONE 'UTC')
        ORDER BY occurred_at, id
      ) AS rn
    FROM activity_events
    WHERE type = 'relay_attached'
      AND actor_sub IS NOT NULL
      AND agent_id IS NOT NULL
      AND payload ->> 'relay' IS NOT NULL
  ) ranked
  WHERE rn > 1
);
--> statement-breakpoint
CREATE UNIQUE INDEX "activity_events_relay_dedup_idx" ON "activity_events" USING btree ("actor_sub","agent_id",("payload" ->> 'relay'),date_trunc('day', "occurred_at" AT TIME ZONE 'UTC')) WHERE "activity_events"."type" = 'relay_attached';
