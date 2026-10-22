// UNIT_BOUNDARY_DESCRIPTION: an agent's chat offers its Environments as a side panel tab only under JanUI, with the feature on, and for a vm agent, the only kind that owns Environments; the current layout keeps them in the sidebar instead.
export function environmentsTabShown({
  newLayout,
  enabled,
  vm,
}: {
  newLayout: boolean;
  enabled: boolean;
  vm: boolean;
}): boolean {
  return newLayout && enabled && vm;
}
