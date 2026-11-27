import type {
  FeatureEntry,
  FeatureId,
  FeatureLevel,
  FeatureMode,
} from "./types.js";
import { featureRegistrySchema } from "./schemas.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: every feature, with its level, its tracking issue
 * and the release it first shipped in at that level. An experimental feature
 * is one any person may try: Settings shows it, and the install gives it a
 * mode. An internal feature is one the team is still trying out: it has no
 * place in the navigation, each person's own switch decides, and the install
 * cannot set it. A feature is experimental only when it is fine for any person
 * to turn it on today. The issue, in dam-agents/dam, names the owner and why
 * the feature exists. A new feature needs an id
 * in `featureIdSchema`, an entry here with its issue, and, when it is
 * internal, its id in the chart's `platform.internalFeatures` list. A feature
 * that changes level takes the release of the change as its `since`. The
 * registry is parsed when the module loads, so an entry without an issue or
 * a release stops every program and test that reads the contract.
 */
export const FEATURES = featureRegistrySchema.parse({
  "advanced-connections": { level: "internal", issue: 6909, since: "v0.3.3" },
  processes: { level: "internal", issue: 6910, since: "v0.3.3" },
  "custom-avatars": { level: "experimental", issue: 6907, since: "v0.3.3" },
  environments: { level: "internal", issue: 6911, since: "v0.3.3" },
  hermes: { level: "internal", issue: 6912, since: "v0.3.3" },
  "github-enterprise-hosts": {
    level: "internal",
    issue: 6913,
    since: "v0.3.3",
  },
  dambledore: { level: "experimental", issue: 6908, since: "v0.3.3" },
  damConnection: { level: "internal", issue: 6914, since: "v0.3.3" },
  "chat-network-approvals": { level: "internal", issue: 6915, since: "v0.3.3" },
  "one-time-tasks": { level: "internal", issue: 6916, since: "v0.3.3" },
  "security-check": { level: "internal", issue: 6917, since: "v0.3.3" },
  "mcp-tool-approval": { level: "internal", issue: 6918, since: "v0.3.3" },
} satisfies Record<FeatureId, FeatureEntry>);

/**
 * UNIT_BOUNDARY_DESCRIPTION: the features of one level, in the order the
 * contract names them.
 */
export function featuresOfLevel(level: FeatureLevel): FeatureId[] {
  return (Object.keys(FEATURES) as FeatureId[]).filter(
    (id) => FEATURES[id].level === level,
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
