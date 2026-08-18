-- Keeps the earliest `entry_point_chosen` row per user and drops the rest, so
-- the partial unique index added in the next migration can be created. Only
-- pre-index installs can hold duplicates; the index keeps the first choice from
-- then on.

DELETE FROM activity_events a
  USING activity_events b
  WHERE a.type = 'entry_point_chosen'
    AND b.type = 'entry_point_chosen'
    AND a.actor_sub IS NOT NULL
    AND a.actor_sub = b.actor_sub
    AND (b.occurred_at, b.id) < (a.occurred_at, a.id);
