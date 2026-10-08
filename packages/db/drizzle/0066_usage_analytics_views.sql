-- Base views for the usage analytics report.
--
-- These views hold the metric definitions and nothing else: one row per user,
-- day, agent or feature, with no time window. The report applies its windows
-- (the last 7 days, calendar weeks, cohorts) as query parameters, which a view
-- cannot take. Every view leaves out the core team, so a panel built on them
-- cannot count core-team traffic by mistake.

-- Fill in the Starter Kit each existing Agent came from, and when its checklist
-- was completed, from the activity rows that still hold them. Starter Kits are
-- newer than the 180-day retention, so every kit Agent still has its row.
-- Completions recorded before this release live only on the live Agent; the
-- api-server copies those at startup.
UPDATE agents AS a
SET starter_kit = k.kit_id
FROM (
  SELECT DISTINCT ON (agent_id) agent_id, payload ->> 'kitId' AS kit_id
  FROM activity_events
  WHERE type = 'starter_kit_applied' AND agent_id IS NOT NULL
  ORDER BY agent_id, occurred_at
) AS k
WHERE k.agent_id = a.id AND a.starter_kit IS NULL;
--> statement-breakpoint
UPDATE agents AS a
SET onboarded_at = o.onboarded_at
FROM (
  SELECT agent_id, MIN(occurred_at) AS onboarded_at
  FROM activity_events
  WHERE type = 'starter_kit_onboarded' AND agent_id IS NOT NULL
  GROUP BY agent_id
) AS o
WHERE o.agent_id = a.id AND a.onboarded_at IS NULL;
--> statement-breakpoint

-- Users the report counts: everyone who has signed in, minus the core team.
-- first_seen_at is the day of the first sign-in and defines the user's cohort.
CREATE VIEW "usage_users" AS
  SELECT actor_sub, first_seen_at
  FROM actor_roles
  WHERE is_core = false;
--> statement-breakpoint

-- Every message a user sent to an agent, from any surface. A session turn names
-- its sender. A Slack or Telegram turn names only the messenger user, so it is
-- attributed through external_actor_links; a sender who never linked an account
-- stays unattributed and is left out. An ambient turn is a message people posted
-- in a channel an agent listens to without being addressed, so it is not a
-- message sent to the agent and is left out too.
CREATE VIEW "usage_user_messages" AS
  SELECT m.actor_sub, m.agent_id, m.occurred_at
  FROM (
    SELECT actor_sub, agent_id, occurred_at
    FROM activity_events
    WHERE type = 'session_turn'
      AND actor_sub IS NOT NULL
    UNION ALL
    SELECT COALESCE(e.actor_sub, l.actor_sub) AS actor_sub, e.agent_id, e.occurred_at
    FROM activity_events e
    LEFT JOIN external_actor_links l
      ON l.provider = e.surface
     AND l.external_actor_hash = e.payload ->> 'externalActorId'
    WHERE e.type = 'channel_turn'
      AND (e.payload ->> 'ambient') IS NULL
  ) m
  JOIN usage_users u ON u.actor_sub = m.actor_sub;
--> statement-breakpoint

-- One row per user and active day. An active day is a UTC day on which the user
-- sent a message to an agent, or had a scheduled event fire on an agent they own,
-- whatever its outcome.
CREATE VIEW "usage_active_days" AS
  SELECT DISTINCT a.actor_sub, (a.occurred_at AT TIME ZONE 'UTC')::date AS day
  FROM (
    SELECT actor_sub, occurred_at FROM usage_user_messages
    UNION ALL
    SELECT e.actor_sub, e.occurred_at
    FROM activity_events e
    JOIN usage_users u ON u.actor_sub = e.actor_sub
    WHERE e.type = 'schedule_fire'
  ) a;
--> statement-breakpoint

-- Agents created from a starter kit, deleted ones included, with the time the
-- user first completed the onboarding checklist and whether a checklist was ever
-- started. Kits that skip onboarding never record a completion, so they never
-- count as completed.
CREATE VIEW "usage_kit_agents" AS
  SELECT
    a.id AS agent_id,
    a.owner_sub AS actor_sub,
    a.starter_kit AS kit_id,
    a.created_at,
    a.onboarded_at,
    (a.onboarding_checklist IS NOT NULL) AS checklist_started
  FROM agents a
  JOIN usage_users u ON u.actor_sub = a.owner_sub
  WHERE a.starter_kit IS NOT NULL;
--> statement-breakpoint

-- The first time each user used each core feature.
--   scheduling:  a scheduled event fired on an agent they own
--   artifact:    they or their agent created an artifact (every creation is published)
--   skills:      they connected a skill source
--   slack_agent: an agent they own posted to a Slack channel
--   starter_kit: they sent a message to an agent they created from a starter kit
CREATE VIEW "usage_feature_firsts" AS
  SELECT f.actor_sub, f.feature, MIN(f.occurred_at) AS first_at
  FROM (
    SELECT actor_sub, 'scheduling' AS feature, occurred_at
    FROM activity_events WHERE type = 'schedule_fire'
    UNION ALL
    SELECT actor_sub, 'artifact', occurred_at
    FROM activity_events WHERE type = 'artifact_published'
    UNION ALL
    SELECT actor_sub, 'skills', occurred_at
    FROM activity_events WHERE type = 'skill_source_added'
    UNION ALL
    SELECT actor_sub, 'slack_agent', occurred_at
    FROM activity_events
    WHERE type = 'channel_message_sent' AND surface = 'slack' AND outcome = 'success'
    UNION ALL
    SELECT m.actor_sub, 'starter_kit', m.occurred_at
    FROM usage_user_messages m
    JOIN usage_kit_agents k ON k.agent_id = m.agent_id AND k.actor_sub = m.actor_sub
  ) f
  JOIN usage_users u ON u.actor_sub = f.actor_sub
  GROUP BY f.actor_sub, f.feature;
--> statement-breakpoint

-- The first time each user set up Slack: bound an agent to a Slack channel
-- (directly or through a starter kit), or connected a Slack account.
CREATE VIEW "usage_slack_setup_firsts" AS
  SELECT e.actor_sub, MIN(e.occurred_at) AS first_at
  FROM activity_events e
  JOIN usage_users u ON u.actor_sub = e.actor_sub
  WHERE e.type = 'slack_channel_bound'
     OR (e.type = 'connection_added' AND e.payload ->> 'templateId' = 'slack')
  GROUP BY e.actor_sub;
--> statement-breakpoint

-- Agents users created, deleted ones included, with the starter kit they came
-- from. Sub-agents that another agent started are not something a user built,
-- so they are left out.
CREATE VIEW "usage_agents_created" AS
  SELECT a.id AS agent_id, a.owner_sub, a.created_at, a.starter_kit AS kit_id
  FROM agents a
  JOIN usage_users u ON u.actor_sub = a.owner_sub
  WHERE NOT EXISTS (SELECT 1 FROM invocations i WHERE i.id = a.id)
    AND NOT EXISTS (
      SELECT 1 FROM activity_events s
      WHERE s.type = 'invocation_spawned'
        AND s.payload ->> 'targetAgentId' = a.id
    );
--> statement-breakpoint

-- One row per agent and UTC day on which it restarted after running out of memory.
CREATE VIEW "usage_agent_oom_days" AS
  SELECT e.agent_id, (e.occurred_at AT TIME ZONE 'UTC')::date AS day
  FROM activity_events e
  JOIN usage_users u ON u.actor_sub = e.actor_sub
  WHERE e.type = 'agent_oom';
