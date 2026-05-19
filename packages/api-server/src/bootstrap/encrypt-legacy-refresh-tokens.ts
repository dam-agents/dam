import type { Db } from "db";
import { identityLinks, isNotNull, eq, and } from "db";
import type { Cipher } from "../modules/channels/infrastructure/cipher.js";

/**
 * One-shot data conversion for ADR-045: encrypt any legacy plaintext
 * `identity_links.refresh_token` rows left over from before column
 * encryption shipped. Idempotent — rows already in the "enc:" form are
 * skipped. Runs at api-server startup after Drizzle SQL migrations,
 * before serving traffic.
 *
 * Lives outside Drizzle migrations because Drizzle migrations are
 * SQL-only and stock Postgres can't compute AES-256-GCM with the app's
 * key.
 */
export async function encryptLegacyRefreshTokens(
  db: Db,
  cipher: Cipher,
): Promise<void> {
  const rows = await db
    .select({
      provider: identityLinks.provider,
      externalUserId: identityLinks.externalUserId,
      refreshToken: identityLinks.refreshToken,
    })
    .from(identityLinks)
    .where(isNotNull(identityLinks.refreshToken));

  let migrated = 0;
  for (const row of rows) {
    if (row.refreshToken === null) continue;
    if (cipher.isEncrypted(row.refreshToken)) continue;
    await db
      .update(identityLinks)
      .set({ refreshToken: cipher.encrypt(row.refreshToken) })
      .where(
        and(
          eq(identityLinks.provider, row.provider),
          eq(identityLinks.externalUserId, row.externalUserId),
        ),
      );
    migrated++;
  }
  if (migrated > 0) {
    console.log(
      `[bootstrap] encrypted ${migrated} legacy refresh_token row(s)`,
    );
  }
}
