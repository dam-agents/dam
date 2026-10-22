-- Sets the measuring start once. Where the meter already stored spend (a
-- deployment that ran spend_daily before this release), the start is 00:00 UTC
-- of the first stored day, so no stored day shows as not measured. Else the
-- start is now: spend_daily came in the same upgrade and is still empty.
INSERT INTO "spend_metering" ("id", "started_at")
SELECT 1, coalesce(
  (SELECT min("day")::timestamp AT TIME ZONE 'UTC' FROM "spend_daily"),
  now()
)
ON CONFLICT ("id") DO NOTHING;
