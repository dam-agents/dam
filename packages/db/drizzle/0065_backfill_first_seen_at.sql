-- Backfills actor_roles.first_seen_at, which the previous migration added with
-- the migration time as its value for every existing row.
--
-- The earliest trace of a user is the oldest activity_events row naming them,
-- usually their first `auth` row. Rows older than the 180-day retention are
-- already gone, so for long-standing users this is the best estimate left, and
-- updated_at caps it in case the log holds nothing older. From now on the
-- column is set when the user first signs in and is never changed.
UPDATE actor_roles AS r
SET first_seen_at = LEAST(r.updated_at, e.first_at)
FROM (
  SELECT actor_sub, MIN(occurred_at) AS first_at
  FROM activity_events
  WHERE actor_sub IS NOT NULL
  GROUP BY actor_sub
) AS e
WHERE e.actor_sub = r.actor_sub;
--> statement-breakpoint
UPDATE actor_roles
SET first_seen_at = updated_at
WHERE first_seen_at > updated_at;
