import type { HarnessCapability } from "agent-runtime-api";
import type { ProfileWithUsage } from "api-server-api";
import { displayNameForTemplate } from "api-server-api";

import { pairSummary } from "../../sessions/lib/session-settings.js";

/** UNIT_BOUNDARY_DESCRIPTION: the provider a profile runs on, by the name Settings gives it. */
export function profileProviderName(profile: ProfileWithUsage): string {
  return (
    displayNameForTemplate(profile.providerTemplate) ?? profile.providerTemplate
  );
}

/** UNIT_BOUNDARY_DESCRIPTION: a profile as the one pick summary, `Model · Effort (Provider)`, beside its harness icon; the effort needs the harness's capability. */
export function profileSummary(
  profile: ProfileWithUsage,
  capability: HarnessCapability | undefined,
): string {
  return pairSummary(profile.model, {
    settings: profile.settings,
    capability,
    provider: profileProviderName(profile),
  });
}

const list = (names: readonly string[]): string =>
  names.length < 2
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/** UNIT_BOUNDARY_DESCRIPTION: what uses a profile, one phrase per kind: "the agents Reginald and Celestine, the schedule “Nightly”". */
export function usedBy(usage: {
  agents: readonly string[];
  channels: readonly string[];
  schedules: readonly string[];
}): string {
  const kind = (singular: string, plural: string, names: readonly string[]) =>
    names.length === 0
      ? []
      : [`the ${names.length === 1 ? singular : plural} ${list(names)}`];
  return [
    ...kind("agent", "agents", usage.agents),
    ...kind("channel", "channels", usage.channels),
    ...kind("schedule", "schedules", usage.schedules),
  ].join(", ");
}
