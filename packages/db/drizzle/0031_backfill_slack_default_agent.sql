-- #3366: Every Slack binding that exists at this point is the sole binding for
-- its conversation — the uniqueness the previous migration dropped guaranteed
-- it. Each is therefore that conversation's default agent, and marking them so
-- keeps a bare mention reaching exactly the agent it reached before.
-- Without this a bare mention in an already-connected channel would resolve to
-- no default at all.
UPDATE channels
SET config = config || '{"default": true}'::jsonb
WHERE type = 'slack'
  AND NOT (config ? 'default');
