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
