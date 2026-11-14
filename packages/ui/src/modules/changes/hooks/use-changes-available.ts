import { useRef } from "react";

import { useChangeSets } from "../api/queries.js";
import { hasGitRepositories } from "../lib/availability.js";
import { useChangesWatch } from "./use-changes-watch.js";

// UNIT_BOUNDARY_DESCRIPTION: whether the Changes tab has anything to show, which decides if its button exists. The button shows only once the list has answered that the agent has a repository, so it never appears and then goes when the answer is none. While a later answer for the same agent is pending, as after a switch of session, the last settled answer stands, so the button does not blink. While the agent has no repository the changes watch stays on, so a repository it clones or creates turns the tab on without a reload.
export function useChangesAvailable(
  agentId: string | null,
  sessionId: string | null,
): boolean {
  const { data, isPlaceholderData } = useChangeSets(agentId, sessionId);
  const hasRepositories = hasGitRepositories({ data, isPlaceholderData });
  const settled = useRef<{ agentId: string | null; has: boolean } | null>(null);
  if (hasRepositories !== undefined)
    settled.current = { agentId, has: hasRepositories };
  useChangesWatch(agentId, hasRepositories === false);
  if (hasRepositories !== undefined) return hasRepositories;
  return settled.current?.agentId === agentId && settled.current.has;
}
