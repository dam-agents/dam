import type { FeatureId, FeatureModes } from "api-server-api";

// UNIT_BOUNDARY_DESCRIPTION: which experimental features the settings tab offers. A feature the install pins on or off is left out, since the switch would change nothing. The new sandbox runtime is also left out unless the install can run microVMs. Nothing is offered until the install has answered, so no row flashes in and out on load.
export function isFeatureOffered(
  id: FeatureId,
  install: { virtualization: boolean; features: FeatureModes } | undefined,
): boolean {
  if (!install || (install.features[id] ?? "experimental") !== "experimental")
    return false;
  if (id === "vm-sandboxes") return install.virtualization;
  return true;
}
