export interface AgentIdentity {
  owner: string;
  agentId: string;
  environmentOf?: string;
}

export interface EgressIdentity {
  ownerSub: string;
  agentId: string;
  environment?: string;
  own?: OwnEgress;
}

// UNIT_BOUNDARY_DESCRIPTION: a child whose egress is its own: open, its launching agent's rules with no prompt, or scoped, widened only by the user, whose prompts surface on the parent.
export interface OwnEgress {
  mode: "open" | "scoped";
  parentAgentId: string;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Whose rules and approvals an egress request falls
 * under. A child whose egress is its own, or whose nearest such ancestor up its
 * launch chain is, falls under that child (`own` says how). An ordinary agent's
 * are its own. An Environment's are its Owning
 * Agent's, of the same owner, and the result names the Environment (by its
 * name, or its id when the row is gone) so an approval says where the request
 * came from. An Environment whose Owning Agent is gone or has another owner
 * resolves to nothing, and the gate denies its request.
 */
export function createEgressIdentityResolver(deps: {
  resolveRoot: (agentId: string) => Promise<string | null>;
  identityOf: (agentId: string) => Promise<AgentIdentity | null>;
  environmentName: (agentId: string) => Promise<string | null>;
  nearestOwnEgress?: (
    agentId: string,
  ) => Promise<({ agentId: string } & OwnEgress) | null>;
}): { resolve(agentId: string): Promise<EgressIdentity | null> } {
  return {
    async resolve(agentId) {
      const own = await deps.nearestOwnEgress?.(agentId);
      if (own) {
        const child = await deps.identityOf(own.agentId);
        if (!child) return null;
        const environment = child.environmentOf
          ? ((await deps.environmentName(child.agentId)) ?? child.agentId)
          : undefined;
        return {
          ownerSub: child.owner,
          agentId: child.agentId,
          ...(environment ? { environment } : {}),
          own: { mode: own.mode, parentAgentId: own.parentAgentId },
        };
      }
      const rootId = await deps.resolveRoot(agentId);
      if (!rootId) return null;
      const self = await deps.identityOf(rootId);
      if (!self) return null;
      if (!self.environmentOf)
        return { ownerSub: self.owner, agentId: self.agentId };
      const owning = await deps.identityOf(self.environmentOf);
      if (!owning || owning.owner !== self.owner) return null;
      return {
        ownerSub: owning.owner,
        agentId: owning.agentId,
        environment: (await deps.environmentName(self.agentId)) ?? self.agentId,
      };
    },
  };
}
