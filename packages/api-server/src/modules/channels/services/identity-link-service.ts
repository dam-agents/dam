import { emit, EventType } from "../../../events.js";
import type {
  IdentityLink,
  IdentityLinkSource,
} from "../infrastructure/identity-links-repository.js";

export interface ExternalLink {
  externalUserId: string;
  teamId: string | null;
  source: IdentityLinkSource;
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
  /** UNIT_BOUNDARY_DESCRIPTION: the pairing's own write — it inserts a row
   *  nobody proved and reports whether one was already there, so the caller can
   *  refuse an account linked to another person instead of overwriting them. */
  linkByEmail(
    provider: string,
    externalUserId: string,
    keycloakSub: string,
    teamId?: string,
  ): Promise<void>;
  unlinkEmailOf(
    provider: string,
    keycloakSub: string,
    teamId?: string,
  ): Promise<number>;
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
  insertByEmail: (
    provider: string,
    externalUserId: string,
    keycloakSub: string,
    teamId?: string,
  ) => Promise<void>;
  deleteEmailOfSub: (
    provider: string,
    keycloakSub: string,
    teamId?: string,
  ) => Promise<number>;
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

    async linkByEmail(provider, externalUserId, keycloakSub, teamId) {
      await deps.insertByEmail(provider, externalUserId, keycloakSub, teamId);
      emit({
        type: EventType.IdentityLinked,
        provider,
        externalUserId,
        keycloakSub,
      });
    },

    async unlinkEmailOf(provider, keycloakSub, teamId) {
      return deps.deleteEmailOfSub(provider, keycloakSub, teamId);
    },

    async unlink(provider, externalUserId) {
      await deps.delete(provider, externalUserId);
    },
  };
}
