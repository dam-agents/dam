-- #3585: How many times in a row a Precheck has broken, counted since the last
-- time the script ran and returned a verdict at all — exit 0 or exit 1 both
-- reset it, only a broken run raises it. A run cannot reset it the way it
-- resets the decline count, because a broken Precheck lets the run through:
-- that count would be stuck at one forever and never say "this has been
-- failing all week".
ALTER TABLE "schedules" ADD COLUMN "precheck_failed_count" integer DEFAULT 0 NOT NULL;