-- The rollback half's assertion: a database restored from the pre-upgrade dump
-- projects identically to the one the snapshot was taken on. Both labels live in
-- the restored database, because the dump carries them.
CREATE TEMP TABLE rehearsal_failure (name text NOT NULL, expected text NOT NULL, actual text);

INSERT INTO rehearsal_failure
SELECT 'rollback.rows', 'every pre-upgrade row, with every column, comes back', string_agg(class || '/' || key, ', ')
FROM (
  (SELECT class, key, payload FROM rehearsal_rows WHERE label = 'before'
   EXCEPT
   SELECT class, key, payload FROM rehearsal_rows WHERE label = 'rollback')
  UNION ALL
  (SELECT class, key, payload FROM rehearsal_rows WHERE label = 'rollback'
   EXCEPT
   SELECT class, key, payload FROM rehearsal_rows WHERE label = 'before')
) d
GROUP BY () HAVING count(*) > 0;

INSERT INTO rehearsal_failure
SELECT 'rollback.counts', 'every pre-upgrade count comes back', string_agg(name, ', ')
FROM (
  (SELECT name, n FROM rehearsal_snapshot WHERE label = 'before'
   EXCEPT
   SELECT name, n FROM rehearsal_snapshot WHERE label = 'rollback')
  UNION ALL
  (SELECT name, n FROM rehearsal_snapshot WHERE label = 'rollback'
   EXCEPT
   SELECT name, n FROM rehearsal_snapshot WHERE label = 'before')
) d
GROUP BY () HAVING count(*) > 0;

DO $$
DECLARE
  problems text;
BEGIN
  SELECT string_agg(format('%s: expected %s, got %s', name, expected, coalesce(actual, '(no detail)')), E'\n')
  INTO problems FROM rehearsal_failure;
  IF problems IS NOT NULL THEN
    RAISE EXCEPTION E'rollback assertions failed:\n%', problems;
  END IF;
END $$;
