// UNIT_BOUNDARY_DESCRIPTION: an agent's chat offers its Environments as a side panel tab only under JanUI and with the feature on; the current layout keeps them in the sidebar instead.
export function environmentsTabShown({
  newLayout,
  enabled,
}: {
  newLayout: boolean;
  enabled: boolean;
}): boolean {
  return newLayout && enabled;
}
