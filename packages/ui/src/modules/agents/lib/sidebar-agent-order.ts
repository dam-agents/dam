import type { ActivitySession } from "../../home/lib/activity-sessions.js";

export function groupSessionsByAgent<T extends ActivitySession>(
  sessions: readonly T[],
): Map<string, T[]> {
  const byAgent = new Map<string, T[]>();
  for (const item of sessions) {
    const group = byAgent.get(item.session.agentId);
    if (group) group.push(item);
    else byAgent.set(item.session.agentId, [item]);
  }
  return byAgent;
}

export function orderByLatestSession<A extends { id: string }>(
  agents: readonly A[],
  sessionsByAgent: ReadonlyMap<string, readonly ActivitySession[]>,
): A[] {
  const latest = (agent: A) => {
    const at = sessionsByAgent.get(agent.id)?.[0]?.at;
    return at === undefined ? null : Date.parse(at);
  };
  return [...agents].sort((a, b) => {
    const [atA, atB] = [latest(a), latest(b)];
    if (atA === null || atB === null)
      return atA === atB ? 0 : atA === null ? 1 : -1;
    return atB - atA;
  });
}

export function openFirst<A extends { id: string }>(
  agents: readonly A[],
  openAgentId: string | null,
): A[] {
  const open = agents.find((agent) => agent.id === openAgentId);
  return open
    ? [open, ...agents.filter((agent) => agent !== open)]
    : [...agents];
}

export function leadAgentId(
  shown: string | null,
  openAgentId: string | null,
  pointerInside: boolean,
): string | null {
  return pointerInside ? shown : openAgentId;
}
