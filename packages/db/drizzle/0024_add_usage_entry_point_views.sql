-- Reporting views over the `entry_point_chosen` activity events: which of the
-- three ways in a user picks from the empty home screen. Hand-written rather
-- than generated, like every other usage_* view — they are aggregates that
-- don't belong in schema.ts.
--
-- Both exclude core-team traffic, as every pilot view does.

CREATE VIEW "usage_entry_point_choices_30d" AS
  SELECT
    payload ->> 'choice' AS choice,
    COUNT(*) AS choice_count,
    COUNT(DISTINCT actor_sub) AS user_count
  FROM activity_events
  WHERE type = 'entry_point_chosen'
    AND occurred_at >= now() - interval '30 days'
    AND actor_sub IS NOT NULL
    AND actor_sub NOT IN (SELECT actor_sub FROM usage_core_actor_subs)
  GROUP BY payload ->> 'choice'
  ORDER BY choice_count DESC;
--> statement-breakpoint
CREATE VIEW "usage_first_entry_point_by_user" AS
  SELECT DISTINCT ON (actor_sub)
    actor_sub,
    payload ->> 'choice' AS first_choice,
    occurred_at AS chosen_at
  FROM activity_events
  WHERE type = 'entry_point_chosen'
    AND actor_sub IS NOT NULL
    AND actor_sub NOT IN (SELECT actor_sub FROM usage_core_actor_subs)
  ORDER BY actor_sub, occurred_at;
