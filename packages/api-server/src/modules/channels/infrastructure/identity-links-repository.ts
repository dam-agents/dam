import type { Db } from "db";
import { identityLinks, eq, and } from "db";

export interface IdentityLink {
  provider: string;
  externalUserId: string;
  keycloakSub: string;
}

export function findIdentityByExternalUser(db: Db) {
  return async (
    provider: string,
    externalUserId: string,
  ): Promise<IdentityLink | null> => {
    const rows = await db
      .select()
      .from(identityLinks)
      .where(
        and(
          eq(identityLinks.provider, provider),
          eq(identityLinks.externalUserId, externalUserId),
        ),
      )
      .limit(1);
    if (rows.length === 0) return null;
    return {
      provider: rows[0].provider,
      externalUserId: rows[0].externalUserId,
      keycloakSub: rows[0].keycloakSub,
    };
  };
}

export function findExternalUsersByIdentity(db: Db) {
  return async (provider: string, keycloakSub: string): Promise<string[]> => {
    const rows = await db
      .select({ externalUserId: identityLinks.externalUserId })
      .from(identityLinks)
      .where(
        and(
          eq(identityLinks.provider, provider),
          eq(identityLinks.keycloakSub, keycloakSub),
        ),
      );
    return rows.map((r) => r.externalUserId);
  };
}

export function findExternalLinksByIdentity(db: Db) {
  return async (
    provider: string,
    keycloakSub: string,
  ): Promise<{ externalUserId: string; teamId: string | null }[]> =>
    db
      .select({
        externalUserId: identityLinks.externalUserId,
        teamId: identityLinks.teamId,
      })
      .from(identityLinks)
      .where(
        and(
          eq(identityLinks.provider, provider),
          eq(identityLinks.keycloakSub, keycloakSub),
        ),
      );
}

export function upsertIdentityLink(db: Db) {
  return async (
    provider: string,
    externalUserId: string,
    keycloakSub: string,
    teamId?: string,
  ): Promise<void> => {
    await db
      .insert(identityLinks)
      .values({ provider, externalUserId, keycloakSub, teamId })
      .onConflictDoUpdate({
        target: [identityLinks.provider, identityLinks.externalUserId],
        set: teamId === undefined ? { keycloakSub } : { keycloakSub, teamId },
      });
  };
}

export function deleteIdentityLink(db: Db) {
  return async (provider: string, externalUserId: string): Promise<void> => {
    await db
      .delete(identityLinks)
      .where(
        and(
          eq(identityLinks.provider, provider),
          eq(identityLinks.externalUserId, externalUserId),
        ),
      );
  };
}
