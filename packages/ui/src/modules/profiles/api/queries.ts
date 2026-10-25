import { skipToken, useQuery } from "@tanstack/react-query";
import type { ProfileWithUsage } from "api-server-api";
import { displayNameForTemplate, parseQualifiedModel } from "api-server-api";

import { trpc } from "../../../trpc.js";

/** UNIT_BOUNDARY_DESCRIPTION: the owner's profiles; one place creates, edits and deletes them, and every picker reads them. */
export function useProfiles(agentId?: string | null) {
  return useQuery({
    ...trpc.profiles.list.queryOptions(
      agentId === undefined ? {} : agentId === null ? skipToken : { agentId },
    ),
    staleTime: 30_000,
  });
}

/** UNIT_BOUNDARY_DESCRIPTION: what a profile row says under its name — the model it runs and the provider it runs on — so a profile never hides the choice it stands for. */
export function profileDetail(profile: ProfileWithUsage): string {
  /* UNIT_BOUNDARY_DESCRIPTION: the upstream id and the provider's own name, so a
   * row reads as the model a person recognises rather than the router's
   * qualified spelling. */
  const upstream =
    parseQualifiedModel(profile.model, { claudePrefix: true })?.upstreamId ??
    profile.model;
  return [upstream, profileProviderName(profile)].join(" · ");
}

export function profileProviderName(profile: ProfileWithUsage): string {
  return (
    displayNameForTemplate(profile.providerTemplate) ?? profile.providerTemplate
  );
}
