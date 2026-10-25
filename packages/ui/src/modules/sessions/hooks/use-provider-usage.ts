import {
  aliasForProviderType,
  type DefaultKind,
  parseQualifiedModel,
  type SessionPair,
} from "api-server-api";

import { useProfiles } from "../../profiles/api/queries.js";
import { useSchedules } from "../../schedules/api/queries.js";
import { useSessionDefaults } from "../api/session-pair.js";
import type { ProviderConnectionRef } from "../lib/session-pair-options.js";

const KINDS: readonly DefaultKind[] = ["chat", "channel", "scheduled"];

export interface ProviderUsage {
  kinds: DefaultKind[];
  schedules: string[];
  /* UNIT_BOUNDARY_DESCRIPTION: the owner's profiles that name this provider and
   * are in use somewhere, so detaching it says which of them stop running. */
  profiles: string[];
}

const aliasOf = (model: string | null | undefined) =>
  model ? parseQualifiedModel(model, { claudePrefix: true })?.alias : undefined;

/**
 * UNIT_BOUNDARY_DESCRIPTION: which of the agent's defaults and schedules run
 * on a provider, so detaching it can say what stops. A default runs on it
 * when it names the Connection or a model of its alias; a schedule does when
 * its own model has that alias, or when it names no model and the scheduled
 * default runs on it.
 */
export function useProviderUsage(
  agentId: string | null,
): (provider: ProviderConnectionRef) => ProviderUsage {
  const { data: saved } = useSessionDefaults(agentId);
  const { data: schedules = [] } = useSchedules(agentId);
  const { data: profiles = [] } = useProfiles();
  return (provider) => {
    const alias = aliasForProviderType(provider.type);
    const runsOn = (pair: SessionPair | null | undefined) =>
      !!pair &&
      (pair.provider === provider.id || aliasOf(pair.model) === alias);
    const effective = (kind: DefaultKind) =>
      kind === "chat" ? saved?.chat : (saved?.[kind] ?? saved?.chat);
    const kinds = KINDS.filter((kind) => runsOn(effective(kind)));
    return {
      kinds,
      schedules: schedules
        .filter((s) =>
          s.model ? aliasOf(s.model) === alias : kinds.includes("scheduled"),
        )
        .map((s) => s.name),
      profiles: profiles
        .filter(
          (profile) =>
            profile.providerTemplate === provider.templateId &&
            profile.usage.agents +
              profile.usage.channels +
              profile.usage.schedules >
              0,
        )
        .map((profile) => profile.name),
    };
  };
}
