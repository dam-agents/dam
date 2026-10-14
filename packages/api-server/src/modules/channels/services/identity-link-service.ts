import { emit, EventType } from "../../../events.js";
import type { IdentityLink } from "../infrastructure/identity-links-repository.js";

export interface ExternalLink {
  externalUserId: string;
  teamId: string | null;
}

export interface IdentityLinkService {
  resolve(provider: string, externalUserId: string): Promise<string | null>;
  externalUsersOf(provider: string, keycloakSub: string): Promise<string[]>;
  externalLinksOf(
    provider: string,
    keycloakSub: string,
  ): Promise<ExternalLink[]>;
  link(
    provider: string,
    externalUserId: string,
    keycloakSub: string,
    teamId?: string,
  ): Promise<void>;
  unlink(provider: string, externalUserId: string): Promise<void>;
}

export function createIdentityLinkService(deps: {
  findByExternalUser: (
    provider: string,
    externalUserId: string,
  ) => Promise<IdentityLink | null>;
  findExternalUsers: (
    provider: string,
    keycloakSub: string,
  ) => Promise<string[]>;
  findExternalLinks: (
    provider: string,
    keycloakSub: string,
  ) => Promise<ExternalLink[]>;
  upsert: (
    provider: string,
    externalUserId: string,
    keycloakSub: string,
    teamId?: string,
  ) => Promise<void>;
  delete: (provider: string, externalUserId: string) => Promise<void>;
}): IdentityLinkService {
  return {
    async resolve(provider, externalUserId) {
      const link = await deps.findByExternalUser(provider, externalUserId);
      return link?.keycloakSub ?? null;
    },

    async externalUsersOf(provider, keycloakSub) {
      return deps.findExternalUsers(provider, keycloakSub);
    },

    async externalLinksOf(provider, keycloakSub) {
      return deps.findExternalLinks(provider, keycloakSub);
    },

    async link(provider, externalUserId, keycloakSub, teamId) {
      await deps.upsert(provider, externalUserId, keycloakSub, teamId);
      emit({
        type: EventType.IdentityLinked,
        provider,
        externalUserId,
        keycloakSub,
      });
    },

    async unlink(provider, externalUserId) {
      await deps.delete(provider, externalUserId);
    },
  };
}
