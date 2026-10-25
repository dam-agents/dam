import {
  AGENT_PERMISSIONS,
  type Agent,
  type AgentsService,
  type AgentWithAccess,
} from "api-server-api";

function owned(agent: Agent): AgentWithAccess {
  return {
    agent,
    access: {
      role: "owner",
      editors: [],
      permissions: [...AGENT_PERMISSIONS],
    },
  };
}

export function ownedAgents(
  agents: Partial<AgentsService>,
): Partial<AgentsService> {
  return {
    ...agents,
    listWithAccess: async () => ((await agents.list?.()) ?? []).map(owned),
    getWithAccess: async (id) => {
      const agent = await agents.get?.(id);
      return agent ? owned(agent) : null;
    },
  };
}
