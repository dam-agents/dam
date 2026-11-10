import type { FeatureId, FeatureMode } from "./types.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the features a person has on until they turn one
 * off, as against the ones they turn on. The assistant is given to everyone
 * (§ rollout, 2026-11-10): its switch still turns it off, so it keeps the
 * `experimental` mode and is read as on where nothing is stored.
 */
export const FEATURES_ON_BY_DEFAULT: ReadonlySet<FeatureId> = new Set([
  "dambledore",
]);

/**
 * UNIT_BOUNDARY_DESCRIPTION: whether one person has a feature on: the install's
 * mode decides, except in `experimental`, where the person's own switch does —
 * and, where nothing is stored, whether the feature is on by default. Nothing is
 * on for anyone while the mode is `off`, and everything is on while it is `on`,
 * whatever a stored switch says.
 */
export function featureOnForUser(mode: FeatureMode, stored: boolean): boolean {
  return mode === "on" || (mode === "experimental" && stored);
}
