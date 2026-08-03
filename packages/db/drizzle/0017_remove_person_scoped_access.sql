-- #2987: Slack access modes are removed — every binding now behaves as the
-- former "shared" mode (the binding is the authorization; anyone the channel
-- admits drives the agent under the agent's own credentials), so the
-- per-agent allowed-users gate has nothing left to gate.
DROP TABLE "allowed_users" CASCADE;
--> statement-breakpoint
-- Person-scoped bindings (config->>'mode' absent or anything but 'shared')
-- are DELETED rather than converted: silently flipping them to shared would
-- escalate who may drive the agent — the safe migration is for the owner to
-- re-bind the channel, explicitly consenting to the shared semantics.
DELETE FROM channels
WHERE type = 'slack'
  AND (config->>'mode') IS DISTINCT FROM 'shared';
--> statement-breakpoint
-- The mode key is dead — strip it from the surviving (shared) bindings so no
-- stale discriminator lingers in config.
UPDATE channels
SET config = config - 'mode'
WHERE type = 'slack'
  AND config ? 'mode';
