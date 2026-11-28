-- The controller learns, for each scoped grant, the key of the derived
-- credential it uses: its gateway sends exactly that derived Secret for the
-- connection, and never the connection's own. A new column at the end of the
-- view keeps its privileges.
CREATE OR REPLACE VIEW control.agent_connection_grants AS
  SELECT agent_id, connection_id, derived_key FROM public.connection_grants;
--> statement-breakpoint

-- Which derived credential a grant uses is part of what its Agent's gateway
-- renders, so a change to it advances the Agent's generation, as a change to
-- the grant set does. `preferred`, `granted_at`, `tool_access` and the scope
-- itself do not: the gateway sees the scope only through the key.
DROP TRIGGER connection_grants_bump_generation ON public.connection_grants;
--> statement-breakpoint

CREATE TRIGGER connection_grants_bump_generation
  AFTER INSERT OR DELETE OR UPDATE OF connection_id, agent_id, derived_key ON public.connection_grants
  FOR EACH ROW EXECUTE FUNCTION control.bump_agents_generation();
