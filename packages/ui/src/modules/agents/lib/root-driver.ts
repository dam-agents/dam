import type { AgentView } from "../../../types.js";

export function rootDriverOf(
  agentId: string,
  agents: readonly AgentView[],
): { id: string; name: string } | null {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  let rootId = byId.get(agentId)?.spawnedBy ?? null;
  if (rootId === null) return null;
  const seen = new Set([agentId]);
  while (!seen.has(rootId)) {
    seen.add(rootId);
    const driver: string | null = byId.get(rootId)?.spawnedBy ?? null;
    if (driver === null) break;
    rootId = driver;
  }
  return { id: rootId, name: byId.get(rootId)?.name ?? rootId };
}
