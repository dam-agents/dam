import type { IdentityLink } from "../infrastructure/identity-links-repository.js";

export interface IdentityLinkService {
  resolve(provider: string, externalUserId: string): Promise<string | null>;
  link(
    provider: string,
    externalUserId: string,
    keycloakSub: string,
    refreshToken: string | null,
  ): Promise<void>;
  unlink(provider: string, externalUserId: string): Promise<void>;
}

export function createIdentityLinkService(deps: {
  findByExternalUser: (
    provider: string,
    externalUserId: string,
  ) => Promise<IdentityLink | null>;
  upsert: (
    provider: string,
    externalUserId: string,
    keycloakSub: string,
    refreshToken: string | null,
  ) => Promise<void>;
  delete: (provider: string, externalUserId: string) => Promise<void>;
}): IdentityLinkService {
  return {
    async resolve(provider, externalUserId) {
      const link = await deps.findByExternalUser(provider, externalUserId);
      return link?.keycloakSub ?? null;
    },

    async link(provider, externalUserId, keycloakSub, refreshToken) {
      await deps.upsert(provider, externalUserId, keycloakSub, refreshToken);
    },

    async unlink(provider, externalUserId) {
      await deps.delete(provider, externalUserId);
    },
  };
}
