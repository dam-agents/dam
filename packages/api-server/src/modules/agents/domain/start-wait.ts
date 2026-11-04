/**
 * UNIT_BOUNDARY_DESCRIPTION: why an Agent that should run has not started
 * yet, in the controller's own sentence: its start was refused for its
 * owner's memory (`OverBudget`), or it waits for room the platform is
 * already making (an idle agent put to sleep, the runner's warm-up after a
 * restart, the node's grant). A start that waits for nothing of the owner's
 * room, such as a boot in progress, has none.
 */
export function startWaitOf(
  agent: {
    overBudget: boolean;
    overBudgetMessage?: string;
    startWaitMessage?: string;
  } | null,
): string | null {
  if (!agent) return null;
  if (agent.overBudget)
    return agent.overBudgetMessage ?? "Your VM agents' memory is full.";
  return agent.startWaitMessage ?? null;
}
