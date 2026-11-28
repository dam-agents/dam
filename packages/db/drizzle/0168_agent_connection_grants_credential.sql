-- The controller learns, for each grant, the credential it uses: its gateway
-- sends exactly that credential's Secret for the connection, and never the
-- connection's own. A new column at the end of the view keeps its privileges.
CREATE OR REPLACE VIEW control.agent_connection_grants AS
  SELECT agent_id, connection_id, credential_id FROM public.connection_grants;
--> statement-breakpoint

-- Which credential a grant uses is part of what its Agent's gateway renders,
-- so a change to it advances the Agent's generation, as a change to the grant
-- set does. `preferred`, `granted_at` and `tool_access` still do not.
DROP TRIGGER connection_grants_bump_generation ON public.connection_grants;
--> statement-breakpoint

CREATE TRIGGER connection_grants_bump_generation
  AFTER INSERT OR DELETE OR UPDATE OF connection_id, agent_id, credential_id ON public.connection_grants
  FOR EACH ROW EXECUTE FUNCTION control.bump_agents_generation();
