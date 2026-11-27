import {
  type FeatureId,
  type FeatureLevel,
  type FeatureModes,
  featuresOfLevel,
} from "api-server-api";

type Install = { features: FeatureModes } | undefined;

// UNIT_BOUNDARY_DESCRIPTION: whether Settings offers a switch for a feature. A feature the install pins on or off is left out, since the switch would change nothing. Nothing is offered until the install has answered, so no row flashes in and out on load. A current api-server names every feature; an api-server from before `featureDefault`, still serving during a rolling deploy, omits the ones the chart does not name, and those read as left to each user.
export function isFeatureOffered(id: FeatureId, install: Install): boolean {
  if (!install) return false;
  return (install.features[id] ?? "user") === "user";
}

// UNIT_BOUNDARY_DESCRIPTION: the features of one level that Settings offers a switch for. The Experimental features tab shows itself only while this is not empty for its level.
export function offeredFeatures(
  level: FeatureLevel,
  install: Install,
): FeatureId[] {
  return featuresOfLevel(level).filter((id) => isFeatureOffered(id, install));
}
