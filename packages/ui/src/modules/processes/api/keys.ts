export const processKeys = {
  agent: (agentId: string) => ["processes", agentId] as const,
  list: (agentId: string) => [...processKeys.agent(agentId), "list"] as const,
  output: (agentId: string, key: string) =>
    [...processKeys.agent(agentId), "output", key] as const,
};
