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

/** UNIT_BOUNDARY_DESCRIPTION: how many places name a profile: agents whose chat default or subagent slot does, channels and schedules, as the list reports them. */
export const profileUses = (profile: ProfileWithUsage): number =>
  profile.usage.agents + profile.usage.channels + profile.usage.schedules;

/** UNIT_BOUNDARY_DESCRIPTION: the one order every list of profiles shows: the default for new agents, then the most used, then by name. Display only: the pickers match a pick to a profile in the server's order, so a reorder never moves a saved reference to a twin with the same values. */
export function sortProfiles(
  profiles: readonly ProfileWithUsage[],
): ProfileWithUsage[] {
  return [...profiles].sort(
    (a, b) =>
      Number(b.newAgentDefault) - Number(a.newAgentDefault) ||
      profileUses(b) - profileUses(a) ||
      a.name.localeCompare(b.name),
  );
}
