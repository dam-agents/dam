import type { AgentState } from "api-server-api";

import type { ActivitySession } from "../../home/lib/activity-sessions.js";

const FOLDED_STATES: ReadonlySet<AgentState> = new Set([
  "hibernating",
  "hibernated",
]);

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

/**
 * UNIT_BOUNDARY_DESCRIPTION: a hibernated Agent folds under See all unless the
 * user has clicked its row in the sidebar, or its chat or configuration page
 * is shown: closing its list keeps the row where the user clicked, so neither
 * the row nor the See all control moves under the pointer.
 */
export function sidebarAgentFolded(
  overrides: Readonly<Record<string, boolean>>,
  agent: { id: string; state: AgentState },
  shownAgentId: string | null,
): boolean {
  return (
    FOLDED_STATES.has(agent.state) &&
    agent.id !== shownAgentId &&
    !(agent.id in overrides)
  );
}
