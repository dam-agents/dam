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
