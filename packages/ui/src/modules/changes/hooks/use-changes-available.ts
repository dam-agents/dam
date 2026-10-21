import { useChangeSets } from "../api/queries.js";
import { useChangesWatch } from "./use-changes-watch.js";

// UNIT_BOUNDARY_DESCRIPTION: whether the Changes tab has anything to show, which decides if the tab exists: the runtime's change set list holds one entry per git repository it found under the agent's roots, so an empty list is an agent with no repository. Every other answer keeps the tab, including an agent that cannot be read while it is not running, and a slow runtime whose answer is still pending, because a tab that disappears once the answer lands is worse than one that arrives late. While the list is empty the changes watch stays on, so a repository the agent clones or creates turns the tab on without a reload.
export function useChangesAvailable(
  agentId: string | null,
  sessionId: string | null,
): boolean {
  const { data } = useChangeSets(agentId, sessionId);
  const none = data?.changeSets.length === 0;
  useChangesWatch(agentId, none);
  return !none;
}
