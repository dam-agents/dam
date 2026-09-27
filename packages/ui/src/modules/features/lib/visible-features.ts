import type { FeatureId } from "api-server-api";

// UNIT_BOUNDARY_DESCRIPTION: which experimental features the settings tab offers. The new sandbox runtime is left out unless the install can run microVMs: on one that cannot, the switch would change nothing a user could see. It stays out until the install has answered, so the row never flashes in and out on load.
export function isFeatureOffered(
  id: FeatureId,
  install: { virtualization?: boolean } | undefined,
): boolean {
  if (id === "vm-sandboxes") return install?.virtualization === true;
  return true;
}
