// UNIT_BOUNDARY_DESCRIPTION: whether an agent shows its Environments anywhere: only a vm agent has any, only while the feature is on, and only once it owns at least one, since an Environment appears when the agent creates it and an empty surface teaches nothing.
export function environmentsShown({
  enabled,
  vm,
  count,
}: {
  enabled: boolean;
  vm: boolean;
  count: number | undefined;
}): boolean {
  return enabled && vm && (count ?? 0) > 0;
}

// UNIT_BOUNDARY_DESCRIPTION: an agent's chat offers its Environments as a side panel tab only under JanUI, with the feature on, and once it owns at least one; the current layout keeps them in the sidebar instead.
export function environmentsTabShown({
  newLayout,
  ...shown
}: {
  newLayout: boolean;
  enabled: boolean;
  vm: boolean;
  count: number | undefined;
}): boolean {
  return newLayout && environmentsShown(shown);
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: whether the unified toolbar offers the panel:
 * once the agent owns one, or while an explicitly opened panel (the Manage
 * row's access list, before the first Environment exists) is the one on screen.
 */
export function environmentsPanelShown({
  open,
  ...shown
}: {
  enabled: boolean;
  vm: boolean;
  count: number | undefined;
  open: boolean;
}): boolean {
  if (environmentsShown(shown)) return true;
  return open && shown.enabled && shown.vm;
}
