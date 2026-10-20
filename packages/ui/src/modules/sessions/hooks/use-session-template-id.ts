import { providerTypeForTemplateId } from "api-server-api";

import { useAgentConnections } from "../../agents/api/queries.js";
import { useAppConnections } from "../../connections/api/queries.js";
import { useAgentSession } from "../api/queries.js";
import { useRememberedPair } from "../api/session-pair.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the Connection template that a session's model
 * calls go to. A session names its provider only when the user picked one;
 * otherwise it runs on the agent's default pair, and an agent with one
 * granted provider Connection uses that one.
 */
export function useSessionTemplateId(
  agentId: string | null,
  sessionId: string | null,
): string | null {
  const { data: session } = useAgentSession(agentId, sessionId);
  const { data: pair } = useRememberedPair(agentId);
  const { data: grants } = useAgentConnections(agentId);
  const { data: connections = [] } = useAppConnections();
  const templateOf = (connectionId: string) =>
    connections.find((c) => c.id === connectionId)?.templateId ?? null;
  const chosen = session?.provider ?? pair?.provider;
  if (chosen) return templateOf(chosen);
  const providers = (grants?.connections ?? [])
    .map((grant) => templateOf(grant.connectionId))
    .filter(
      (templateId) => templateId && providerTypeForTemplateId(templateId),
    );
  return providers.length === 1 ? (providers[0] ?? null) : null;
}
