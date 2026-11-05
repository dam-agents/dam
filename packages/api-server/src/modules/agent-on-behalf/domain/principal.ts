import type { UserIdentity } from "api-server-api";
import { AGENT_ON_BEHALF_SCOPES } from "api-server-api";

export interface AgentOnBehalfIdentity {
  agentId: string;
  ownerSub: string;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the principal an assistant's own identity becomes —
 * its owner, over that owner's Agents, with the read half of their credentials
 * and never `credentials:manage`; never an operator, and never a person, so the
 * gates that need one refuse it. Derived from the identity alone, so whoever
 * proves the Agent can compose it: today that is a verified `ob_` token at the
 * api-server's door, and the harness route that already holds the Agent's
 * identity can compose the very same principal without a bearer at all.
 */
export function agentOnBehalfUser(
  identity: AgentOnBehalfIdentity,
): UserIdentity {
  return {
    sub: identity.ownerSub,
    preferredUsername: identity.ownerSub,
    scopes: AGENT_ON_BEHALF_SCOPES,
    agentIds: "*",
    onBehalfAgentId: identity.agentId,
  };
}
