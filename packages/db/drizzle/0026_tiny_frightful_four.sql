-- #3214: `entryPointChosen` is a tRPC mutation the browser calls, so an
-- authenticated client can repeat it and inflate the entry-point views. One
-- row per user, as the auth events are bounded to one per (sub, surface, day);
-- the repository already inserts with ON CONFLICT DO NOTHING, so repeats are
-- discarded and the first choice is the one that stands.

CREATE UNIQUE INDEX "activity_events_entry_point_dedup_idx" ON "activity_events" USING btree ("actor_sub","type") WHERE "activity_events"."type" = 'entry_point_chosen';