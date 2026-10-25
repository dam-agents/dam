import type { ProfileWithUsage } from "api-server-api";
import { displayNameForTemplate, parseQualifiedModel } from "api-server-api";

/** UNIT_BOUNDARY_DESCRIPTION: the provider a profile runs on, by the name Settings gives it. */
export function profileProviderName(profile: ProfileWithUsage): string {
  return (
    displayNameForTemplate(profile.providerTemplate) ?? profile.providerTemplate
  );
}

/** UNIT_BOUNDARY_DESCRIPTION: the upstream id and the provider's own name, so a profile reads as the model a person recognises rather than the router's qualified spelling. */
export function profileDetail(profile: ProfileWithUsage): string {
  const upstream =
    parseQualifiedModel(profile.model, { claudePrefix: true })?.upstreamId ??
    profile.model;
  return [upstream, profileProviderName(profile)].join(" · ");
}
