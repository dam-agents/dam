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

/**
 * UNIT_BOUNDARY_DESCRIPTION: an Agent's Sessions show in the sidebar while the
 * user has opened the Agent there, by a click on its row; until the user
 * clicks it, the Agent whose chat or configuration page is shown is open.
 */
export function sidebarAgentOpen(
  overrides: Readonly<Record<string, boolean>>,
  agentId: string,
  shownAgentId: string | null,
): boolean {
  return overrides[agentId] ?? agentId === shownAgentId;
}
