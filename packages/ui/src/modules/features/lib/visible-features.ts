import type { FeatureId, FeatureModes } from "api-server-api";

// UNIT_BOUNDARY_DESCRIPTION: which experimental features the settings tab offers. A feature the install pins on or off is left out, since the switch would change nothing. Nothing is offered until the install has answered, so no row flashes in and out on load. A current api-server names every feature; an api-server from before `featureDefault`, still serving during a rolling deploy, omits the ones the chart does not name, and those read as experimental.
export function isFeatureOffered(
  id: FeatureId,
  install: { features: FeatureModes } | undefined,
): boolean {
  if (!install) return false;
  return (install.features[id] ?? "experimental") === "experimental";
}
