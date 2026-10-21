export interface AgentIdentity {
  owner: string;
  agentId: string;
  environmentOf?: string;
}

export interface EgressIdentity {
  ownerSub: string;
  agentId: string;
  environment?: string;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Whose rules and approvals an egress request falls
 * under. An ordinary agent's are its own. An Environment's are its Owning
 * Agent's, of the same owner, and the result names the Environment (by its
 * name, or its id when the row is gone) so an approval says where the request
 * came from. An Environment whose Owning Agent is gone or has another owner
 * resolves to nothing, and the gate denies its request.
 */
export function createEgressIdentityResolver(deps: {
  resolveRoot: (agentId: string) => Promise<string | null>;
  identityOf: (agentId: string) => Promise<AgentIdentity | null>;
  environmentName: (agentId: string) => Promise<string | null>;
}): { resolve(agentId: string): Promise<EgressIdentity | null> } {
  return {
    async resolve(agentId) {
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
