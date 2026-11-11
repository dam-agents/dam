-- People who used the platform in Slack before the note had its new rules
-- never get it. A Slack turn records its writer as the keyed hash of their
-- Slack user id, the same key the note's record uses, so each of them is
-- written as graduated, with their earliest turn as their first use.
INSERT INTO "slack_untagged_reply_notes" ("actor_hash", "first_used_at", "graduated_at")
SELECT e."payload" ->> 'externalActorId', min(e."occurred_at"), now()
FROM "activity_events" e
WHERE e."type" = 'channel_turn'
  AND e."surface" = 'slack'
  AND e."payload" ->> 'externalActorId' IS NOT NULL
GROUP BY e."payload" ->> 'externalActorId'
ON CONFLICT DO NOTHING;
