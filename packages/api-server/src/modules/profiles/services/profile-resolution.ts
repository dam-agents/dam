import {
  displayNameForTemplate,
  parseQualifiedModel,
  providerAliasConflict,
  type ProfileUnavailableReason,
  type SessionPair,
} from "api-server-api";
import type { ProfilesRepository } from "../infrastructure/profiles-repository.js";

export interface ResolvedProfile {
  profile: {
    id: string;
    name: string;
    harness: string;
    providerTemplate: string;
    model: string;
    settings: Record<string, string>;
  };
  /** UNIT_BOUNDARY_DESCRIPTION: the pair a reference resolves to; `provider` is null when nothing the agent holds can run it. */
  pair: SessionPair;
  /** UNIT_BOUNDARY_DESCRIPTION: an owned but ungranted provider is attachable when the agent holds no rival alias, so the caller grants it before saving rather than replacing one silently. */
  grantableProvider: string | null;
  unavailable: { reason: ProfileUnavailableReason; detail: string } | null;
}

export interface ProfileResolverDeps {
  repo: ProfilesRepository;
  /** UNIT_BOUNDARY_DESCRIPTION: what the agent's runtime reports carrying; absent until a runtime has answered, which leaves the harness unchecked. */
  carriedHarnesses?: (agentId: string) => Promise<readonly string[] | null>;
  /** UNIT_BOUNDARY_DESCRIPTION: the upstream ids the harness last listed; absent while the agent sleeps, which leaves the model unchecked. */
  listedModels?: (
    agentId: string,
    harness: string,
  ) => Promise<readonly string[] | null>;
}

export interface ProfileResolver {
  resolve(input: {
    profileId: string;
    owner: string;
    agentId?: string;
  }): Promise<ResolvedProfile | null>;
  /**
   * UNIT_BOUNDARY_DESCRIPTION: a reference already stored on a row is resolved
   * by that row's authority, so a read passes no owner. A write passes the
   * caller's owner and the profile must be theirs, or another owner's profile
   * could be attached to this agent and moved by its owner's edits.
   */
  resolveStored(input: {
    profileId: string;
    agentId: string;
    owner?: string;
  }): Promise<ResolvedProfile | null>;
}

/** UNIT_BOUNDARY_DESCRIPTION: the shape a reader of stored references needs — the harness-config repository and the schedules repository resolve through it — so neither has to know what a profile is. */
export interface StoredProfileResolver {
  resolveStored: ProfileResolver["resolveStored"];
}

export function createProfileResolver(
  deps: ProfileResolverDeps,
): ProfileResolver {
  return {
    async resolve({ profileId, owner, agentId }) {
      const profile = await deps.repo.get(owner, profileId);
      if (!profile) return null;
      const provider = await resolveProvider(
        deps.repo,
        owner,
        agentId,
        profile,
      );
      return {
        profile: {
          id: profile.id,
          name: profile.name,
          harness: profile.harness,
          providerTemplate: profile.providerTemplate,
          model: profile.model,
          settings: profile.settings,
        },
        pair: {
          harness: profile.harness,
          provider: provider.connectionId,
          model: profile.model,
          ...(Object.keys(profile.settings).length > 0 && {
            settings: profile.settings,
          }),
        },
        grantableProvider: provider.grantable,
        unavailable:
          provider.unavailable ??
          (await checkRuntime(deps, agentId, profile.harness, profile.model)),
      };
    },

    async resolveStored({ profileId, agentId, owner }) {
      const profile = await deps.repo.getById(profileId);
      if (!profile) return null;
      if (owner !== undefined && profile.owner !== owner) return null;
      const provider = await resolveProvider(
        deps.repo,
        profile.owner,
        agentId,
        profile,
      );
      return {
        profile: {
          id: profile.id,
          name: profile.name,
          harness: profile.harness,
          providerTemplate: profile.providerTemplate,
          model: profile.model,
          settings: profile.settings,
        },
        pair: {
          harness: profile.harness,
          provider: provider.connectionId,
          model: profile.model,
          ...(Object.keys(profile.settings).length > 0 && {
            settings: profile.settings,
          }),
        },
        grantableProvider: provider.grantable,
        unavailable:
          provider.unavailable ??
          (await checkRuntime(deps, agentId, profile.harness, profile.model)),
      };
    },
  };
}

/** UNIT_BOUNDARY_DESCRIPTION: the profile's provider is a template, so which Connection runs follows from the agent's grants: its own Connection of that template, or the owner's, which is attachable only while no rival alias is held. */
async function resolveProvider(
  repo: ProfilesRepository,
  owner: string,
  agentId: string | undefined,
  profile: { providerTemplate: string },
): Promise<{
  connectionId: string | null;
  grantable: string | null;
  unavailable: ResolvedProfile["unavailable"];
}> {
  const owned = (await repo.ownerConnections(owner)).filter(
    (connection) => connection.templateId === profile.providerTemplate,
  );
  const granted =
    agentId === undefined ? [] : await repo.agentConnections(owner, agentId);
  /* UNIT_BOUNDARY_DESCRIPTION: the agent's own grant wins over the owner's
   * oldest, so an owner holding two Connections of one template never has the
   * second reported as a rival of itself. */
  const template =
    owned.find((connection) => granted.some((g) => g.id === connection.id)) ??
    owned[0];
  if (!template)
    return {
      connectionId: null,
      grantable: null,
      unavailable: {
        reason: "no-provider",
        detail: `${displayNameForTemplate(profile.providerTemplate) ?? profile.providerTemplate} is not connected`,
      },
    };
  if (agentId === undefined || granted.some((c) => c.id === template.id))
    return { connectionId: template.id, grantable: null, unavailable: null };
  const rival = providerAliasConflict(granted, template);
  if (rival)
    return {
      connectionId: null,
      grantable: null,
      unavailable: {
        reason: "rival-provider",
        detail: `this agent runs on ${rival.held.name}; detach it to use ${template.name}`,
      },
    };
  return {
    connectionId: template.id,
    grantable: template.id,
    unavailable: null,
  };
}

async function checkRuntime(
  deps: ProfileResolverDeps,
  agentId: string | undefined,
  harness: string,
  model: string,
): Promise<ResolvedProfile["unavailable"]> {
  if (agentId === undefined) return null;
  const carried = await deps.carriedHarnesses?.(agentId);
  if (carried && !carried.includes(harness))
    return {
      reason: "harness-not-carried",
      detail: `this agent's image does not carry ${harness}`,
    };
  const listed = await deps.listedModels?.(agentId, harness);
  if (
    listed &&
    listed.length > 0 &&
    !listed.some((id) => sameUpstream(id, model))
  )
    return {
      reason: "model-not-listed",
      detail: `${model} is not offered by ${harness} on this agent`,
    };
  return null;
}

function sameUpstream(listed: string, model: string): boolean {
  const a = parseQualifiedModel(listed, { claudePrefix: true });
  const b = parseQualifiedModel(model, { claudePrefix: true });
  if (!a || !b) return false;
  return (
    a.alias === b.alias &&
    a.upstreamId.toLowerCase() === b.upstreamId.toLowerCase()
  );
}
