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

export function upsertIdentityLink(db: Db) {
  return async (
    provider: string,
    externalUserId: string,
    keycloakSub: string,
  ): Promise<void> => {
    await db
      .insert(identityLinks)
      .values({ provider, externalUserId, keycloakSub })
      .onConflictDoUpdate({
        target: [identityLinks.provider, identityLinks.externalUserId],
        set: { keycloakSub },
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
