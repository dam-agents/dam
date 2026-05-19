import type { Db } from "db";
import { identityLinks, eq, and } from "db";
import type { Cipher } from "./cipher.js";

export interface IdentityLink {
  provider: string;
  externalUserId: string;
  keycloakSub: string;
  refreshToken: string | null;
}

export function findIdentityByExternalUser(db: Db, cipher: Cipher) {
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
    const stored = rows[0].refreshToken;
    let refreshToken: string | null = null;
    if (stored !== null) {
      if (cipher.isEncrypted(stored)) {
        refreshToken = cipher.decrypt(stored);
      } else {
        // Legacy plaintext row — lazily encrypt in place so subsequent reads
        // take the normal path. Returns the plaintext to the caller as
        // usual; the row is now encrypted on disk.
        refreshToken = stored;
        await db
          .update(identityLinks)
          .set({ refreshToken: cipher.encrypt(stored) })
          .where(
            and(
              eq(identityLinks.provider, provider),
              eq(identityLinks.externalUserId, externalUserId),
            ),
          );
      }
    }
    return {
      provider: rows[0].provider,
      externalUserId: rows[0].externalUserId,
      keycloakSub: rows[0].keycloakSub,
      refreshToken,
    };
  };
}

export function upsertIdentityLink(db: Db, cipher: Cipher) {
  return async (
    provider: string,
    externalUserId: string,
    keycloakSub: string,
    refreshToken: string | null,
  ): Promise<void> => {
    const encrypted =
      refreshToken === null ? null : cipher.encrypt(refreshToken);
    await db
      .insert(identityLinks)
      .values({
        provider,
        externalUserId,
        keycloakSub,
        refreshToken: encrypted,
      })
      .onConflictDoUpdate({
        target: [identityLinks.provider, identityLinks.externalUserId],
        set: { keycloakSub, refreshToken: encrypted },
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
