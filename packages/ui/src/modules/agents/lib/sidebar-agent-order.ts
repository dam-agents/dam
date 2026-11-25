import type { AgentState } from "api-server-api";

const FOLDED_STATES: ReadonlySet<AgentState> = new Set([
  "hibernating",
  "hibernated",
]);

/**
 * UNIT_BOUNDARY_DESCRIPTION: a hibernated Agent folds under See all unless
 * its chat is shown or it is the Agent the sidebar was last narrowed to, so
 * the row the user clicked stays where it was when they go back to All
 * agents, also from a page that is not its chat.
 */
export function sidebarAgentFolded(
  agent: { id: string; state: AgentState },
  shownAgentId: string | null,
  lastAgent: string | null,
): boolean {
  return (
    FOLDED_STATES.has(agent.state) &&
    agent.id !== shownAgentId &&
    agent.id !== lastAgent
  );
}
