import type { EnvironmentView } from "api-server-api";

// UNIT_BOUNDARY_DESCRIPTION: the Environments the Artifacts list shows: in an agent's chat, scoped to that agent, only its own; with a search, only those whose name holds the term, as an artifact's title does.
export function visibleEnvironments(
  environments: readonly EnvironmentView[],
  { agentId, term }: { agentId: string | null; term: string },
): EnvironmentView[] {
  return environments.filter(
    (e) =>
      (agentId === null || e.owningAgentId === agentId) &&
      (term === "" || e.name.toLowerCase().includes(term)),
  );
}

// UNIT_BOUNDARY_DESCRIPTION: what an Environment's row says of its machine: running, starting, or sleeping, which it does when nobody uses it; any other state is not running, and opening a link wakes it.
export function environmentStateLabel(state: string): string {
  if (state === "running") return "Running";
  if (state === "starting" || state === "preparing_workspace")
    return "Starting";
  if (state === "hibernating" || state === "hibernated") return "Sleeping";
  return "Not running";
}

// UNIT_BOUNDARY_DESCRIPTION: who the Share dialog says may open an Environment through its agent: the owner, the agent's editors, and how many Agent Environment Members the agent has; the people of the Environment's own list are listed below it, one by one.
export function sharedThroughAgent({
  agentName,
  editorCount,
  agentMemberCount,
}: {
  agentName: string;
  editorCount: number;
  agentMemberCount: number;
}): string {
  const parts = ["you"];
  if (editorCount > 0) parts.push(`${agentName}'s editors`);
  if (agentMemberCount > 0)
    parts.push(
      `${agentMemberCount} ${agentMemberCount === 1 ? "person" : "people"} from ${agentName}`,
    );
  const last = parts.pop()!;
  return `Open to ${parts.length > 0 ? `${parts.join(", ")} and ${last}` : last}.`;
}
