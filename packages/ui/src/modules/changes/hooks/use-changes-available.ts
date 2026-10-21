import { useChangeSets } from "../api/queries.js";
import { hasGitRepositories } from "../lib/availability.js";
import { useChangesWatch } from "./use-changes-watch.js";

// UNIT_BOUNDARY_DESCRIPTION: whether the Changes tab has anything to show, which decides if the tab exists. Every answer that is not a settled empty list for this agent keeps the tab: a slow runtime whose answer is still pending, and an agent that cannot be read while it is not running, because a tab that disappears once the answer lands is worse than one that arrives late. While the agent has no repository the changes watch stays on, so a repository it clones or creates turns the tab on without a reload.
export function useChangesAvailable(
  agentId: string | null,
  sessionId: string | null,
): boolean {
  const { data, isPlaceholderData } = useChangeSets(agentId, sessionId);
  const hasRepositories = hasGitRepositories({ data, isPlaceholderData });
  useChangesWatch(agentId, hasRepositories === false);
  return hasRepositories !== false;
}
