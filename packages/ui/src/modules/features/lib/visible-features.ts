import type { FeatureId, FeatureModes } from "api-server-api";

// UNIT_BOUNDARY_DESCRIPTION: which experimental features the settings tab offers. A feature the install pins on or off is left out, since the switch would change nothing. Environments, which run on microVMs, are also left out unless the install can run them. Nothing is offered until the install has answered, so no row flashes in and out on load. A current api-server names every feature; an api-server from before `featureDefault`, still serving during a rolling deploy, omits the ones the chart does not name, and those read as experimental.
export function isFeatureOffered(
  id: FeatureId,
  install: { features: FeatureModes; virtualization: boolean } | undefined,
): boolean {
  if (!install || (install.features[id] ?? "experimental") !== "experimental")
    return false;
  if (id === "environments") return install.virtualization;
  return true;
}
