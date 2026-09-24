-- #4003: An mcp-entry's name becomes the prefix on every tool it carries, and
-- the two names the platform injects under are now reserved: naming refuses
-- them, and a granted entry wearing one is dropped when an Agent's state is
-- built. Neither reaches an Agent that already holds such an entry, though —
-- delivery only happens when the desired version moves, and nothing moves it
-- for a connection that has not changed. This bumps it once for exactly those
-- Agents, so the next delivery drops the entry and restores the platform's own
-- server in its place.
UPDATE runtime_state_outbox o
SET version = o.version + 1,
    last_enqueued_at = now()
WHERE EXISTS (
  SELECT 1
  FROM connection_grants g
  JOIN connections c ON c.id = g.connection_id
  WHERE g.agent_id = o.agent_id
    AND jsonb_path_exists(
      c.contributions,
      '$[*] ? (@.kind == "mcp-entry" && (@.name == "platform-outbound" || @.name == "knowledge-bases"))'
    )
);
