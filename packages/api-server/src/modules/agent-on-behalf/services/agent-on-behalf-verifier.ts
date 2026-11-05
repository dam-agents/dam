import { err, ok, type Result } from "../../../core/result.js";

export type AgentOnBehalfRefusal =
  | "agent-gone"
  | "owner-mismatch"
  | "not-assistant"
  | "flag-off"
  | "owner-inactive";

export interface AgentOnBehalfVerifierDeps {
  agentOf: (
    agentId: string,
  ) => Promise<{ owner: string | null; kind?: string } | null>;
  /* UNIT_BOUNDARY_DESCRIPTION: whether the install offers assistants to this owner right now — read at every request, so switching the feature off ends the reach of every assistant already provisioned. */
  featureOn: (ownerSub: string) => Promise<boolean>;
  /* UNIT_BOUNDARY_DESCRIPTION: whether the owner behind the Agent is still a person the install admits, asked of the directory every time and refusing whenever the directory cannot answer. */
  ownerActive: (ownerSub: string) => Promise<boolean>;
}

export interface AgentOnBehalfIdentity {
  agentId: string;
  ownerSub: string;
}

export type AgentOnBehalfVerifier = (
  agentId: string,
) => Promise<Result<AgentOnBehalfIdentity, AgentOnBehalfRefusal>>;

/**
 * UNIT_BOUNDARY_DESCRIPTION: what makes an Agent allowed to act for its owner at
 * this moment. Who the Agent is, the transport has already proven — the harness
 * path is reachable only from that Agent's own gateway, which the mesh admits
 * for its own `/api/agents/<id>/` prefix and for no sibling. What the transport
 * cannot know is read here, live: the Agent still exists, it is an assistant,
 * its owner label still names the owner it acts for, that owner is still an
 * admitted person, and this install still offers assistants to them.
 */
export function verifyAgentOnBehalf(
  deps: AgentOnBehalfVerifierDeps,
): AgentOnBehalfVerifier {
  return async (agentId) => {
    const agent = await deps.agentOf(agentId);
    if (!agent) return err("agent-gone");
    if (agent.kind !== "assistant") return err("not-assistant");
    if (agent.owner === null) return err("owner-mismatch");
    const active = await deps.ownerActive(agent.owner).catch(() => false);
    if (!active) return err("owner-inactive");
    const offered = await deps.featureOn(agent.owner).catch(() => false);
    if (!offered) return err("flag-off");
    return ok({ agentId, ownerSub: agent.owner });
  };
}
