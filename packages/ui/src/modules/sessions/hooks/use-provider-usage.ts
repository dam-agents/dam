import {
  aliasForProviderType,
  type DefaultKind,
  parseQualifiedModel,
  type SessionPair,
} from "api-server-api";

import { useAgent } from "../../agents/api/queries.js";
import { useProfiles } from "../../profiles/api/queries.js";
import { useSchedules } from "../../schedules/api/queries.js";
import { useSessionDefaults } from "../api/session-pair.js";
import type { ProviderConnectionRef } from "../lib/session-pair-options.js";
import { subagentProfileOf } from "../lib/subagent-choice.js";

const KINDS: readonly DefaultKind[] = ["chat", "channel", "scheduled"];

export interface ProviderUsage {
  kinds: DefaultKind[];
  schedules: string[];
  profiles: string[];
}

const aliasOf = (model: string | null | undefined) =>
  model ? parseQualifiedModel(model, { claudePrefix: true })?.alias : undefined;

/**
 * UNIT_BOUNDARY_DESCRIPTION: which of the agent's defaults, schedules and
 * profiles run on a provider, so detaching it can say what stops. A default
 * runs on it when it names the Connection or a model of its alias; a schedule
 * does when its own model has that alias, or when it names no model and the
 * scheduled default runs on it; a profile does when it is of the provider's
 * template and this agent's chat default, subagent slot, a channel or a
 * schedule names it, never for another agent's use.
 */
export function useProviderUsage(
  agentId: string | null,
): (provider: ProviderConnectionRef) => ProviderUsage {
  const { data: saved } = useSessionDefaults(agentId);
  const { data: schedules = [] } = useSchedules(agentId);
  const { data: profiles = [] } = useProfiles();
  const channels = useAgent(agentId)?.channels ?? [];
  const named = new Set(
    [
      saved?.chatProfileId,
      subagentProfileOf(saved?.chat ?? null, profiles)?.id,
      ...schedules.map((s) => s.profile),
      ...channels.map((c) => c.profileId),
    ].filter((id) => typeof id === "string"),
  );
  return (provider) => {
    const alias = aliasForProviderType(provider.type);
    const runsOn = (pair: SessionPair | null | undefined) =>
      !!pair &&
      (pair.provider === provider.id || aliasOf(pair.model) === alias);
    const effective = (kind: DefaultKind) =>
      kind === "chat" ? saved?.chat : (saved?.[kind] ?? saved?.chat);
    const kinds = KINDS.filter((kind) => runsOn(saved?.[kind]));
    return {
      kinds,
      schedules: schedules
        .filter((s) =>
          s.model ? aliasOf(s.model) === alias : runsOn(effective("scheduled")),
        )
        .map((s) => s.name),
      profiles: profiles
        .filter(
          (profile) =>
            profile.providerTemplate === provider.templateId &&
            named.has(profile.id),
        )
        .map((profile) => profile.name),
    };
  };
}
