import type { ChangeSetList } from "agent-runtime-api";

// UNIT_BOUNDARY_DESCRIPTION: reads the change set list as an answer about the agent's repositories: true when it holds one, false when the runtime settled on none, and undefined while the answer is not in yet, or is the previous agent's list that the query kept as placeholder data across a switch, so no verdict carries over from one agent to the next.
export function hasGitRepositories(answer: {
  data: ChangeSetList | undefined;
  isPlaceholderData: boolean;
}): boolean | undefined {
  if (answer.data === undefined || answer.isPlaceholderData) return undefined;
  return answer.data.changeSets.length > 0;
}
