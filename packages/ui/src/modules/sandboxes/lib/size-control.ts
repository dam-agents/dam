// UNIT_BOUNDARY_DESCRIPTION: the size control works wherever the controller sizes a machine from the agent's spec, which includes a host runner. It is hidden only on a pool-sized runner, where the machine takes half its owner's pool and ignores the spec.
export function sizeControlOffered(
  agent: { vm: boolean },
  vmAgentSizing: "spec" | "pool" | undefined,
): boolean {
  return !agent.vm || vmAgentSizing !== "pool";
}
