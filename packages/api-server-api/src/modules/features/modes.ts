import type { FeatureMode } from "./types.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: whether one person has a feature on: the install's
 * mode decides, except in `experimental`, where the person's own switch does.
 * Nothing is on for anyone while the mode is `off`, and everything is on while
 * it is `on`, whatever a stored switch says.
 */
export function featureOnForUser(mode: FeatureMode, stored: boolean): boolean {
  return mode === "on" || (mode === "experimental" && stored);
}
