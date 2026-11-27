import type { FeatureId, FeatureLevel, FeatureMode } from "./types.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the level of every feature. An experimental
 * feature is one any person may try: Settings shows it, and the install gives
 * it a mode. An internal feature is one the team is still trying out: it has
 * no place in the navigation, each person's own switch decides, and the
 * install cannot set it. A feature is experimental only when it is fine for
 * any person to turn it on today.
 */
export const FEATURE_LEVELS: Record<FeatureId, FeatureLevel> = {
  "advanced-connections": "internal",
  processes: "internal",
  "custom-avatars": "experimental",
  environments: "internal",
  hermes: "internal",
  "github-enterprise-hosts": "internal",
  dambledore: "experimental",
  damConnection: "internal",
  "chat-network-approvals": "internal",
  "one-time-tasks": "internal",
  "security-check": "internal",
  "mcp-tool-approval": "internal",
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: the features of one level, in the order the
 * contract names them.
 */
export function featuresOfLevel(level: FeatureLevel): FeatureId[] {
  return (Object.keys(FEATURE_LEVELS) as FeatureId[]).filter(
    (id) => FEATURE_LEVELS[id] === level,
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the features a person has on until they turn one
 * off, as against the ones they turn on. The assistant is given to everyone
 * (§ rollout, 2026-11-10): its switch still turns it off, so it keeps the
 * `user` mode and is read as on where nothing is stored.
 */
export const FEATURES_ON_BY_DEFAULT: ReadonlySet<FeatureId> = new Set([
  "dambledore",
]);

/**
 * UNIT_BOUNDARY_DESCRIPTION: the harnesses an owner's flags keep out of every
 * list a picker reads: the Hermes harness while its flag is off
 * (docs/architecture/features.md). Only what is offered is gated — a change or
 * a session that names one still goes through.
 */
export function hiddenHarnessesFor(
  flags: Partial<Record<FeatureId, boolean>>,
): ReadonlySet<string> {
  return new Set(flags.hermes ? [] : ["hermes"]);
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: whether one person has a feature on: the install's
 * mode decides, except in `user`, where the person's own switch does —
 * and, where nothing is stored, whether the feature is on by default. Nothing is
 * on for anyone while the mode is `off`, and everything is on while it is `on`,
 * whatever a stored switch says.
 */
export function featureOnForUser(mode: FeatureMode, stored: boolean): boolean {
  return mode === "on" || (mode === "user" && stored);
}
