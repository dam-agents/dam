// UNIT_BOUNDARY_DESCRIPTION: whether an agent shows its Environments anywhere: only while the feature is on, and only once it owns at least one, since an Environment appears when the agent creates it and an empty surface teaches nothing.
export function environmentsShown({
  enabled,
  count,
}: {
  enabled: boolean;
  count: number | undefined;
}): boolean {
  return enabled && (count ?? 0) > 0;
}
