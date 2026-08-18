-- Keeps the earliest `entry_point_chosen` row per user and drops the rest, so
-- the partial unique index added in the next migration can be created. Only
-- pre-index installs can hold duplicates; the index keeps the first choice from
-- then on.
--
-- Ranks within each actor rather than joining the table to itself, for the
-- reason 0026 records: a self-join enumerates every ordered pair in a group, and
-- migrations run inside one transaction awaited during api-server startup, so a
-- group an unbounded client had filled would turn a boot into a timeout. The
-- NOT NULL guard keeps this equivalent to the index — PARTITION BY groups NULLs
-- together, a unique index treats them as distinct.

DELETE FROM activity_events
WHERE id IN (
  SELECT id
  FROM (
    SELECT
      id,
      row_number() OVER (
        PARTITION BY actor_sub
        ORDER BY occurred_at, id
      ) AS rn
    FROM activity_events
    WHERE type = 'entry_point_chosen'
      AND actor_sub IS NOT NULL
  ) ranked
  WHERE rn > 1
);
