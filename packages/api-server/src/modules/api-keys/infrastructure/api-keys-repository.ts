import {
  apiKeyRevocations,
  apiKeys,
  and,
  desc,
  eq,
  inArray,
  isNull,
  sql,
  type Db,
} from "db";
import type { Scope } from "api-server-api";
import type { ApiKeyRow, NewApiKey } from "../domain/types.js";

function toRow(r: typeof apiKeys.$inferSelect): ApiKeyRow {
  return {
    id: r.id,
    ownerSub: r.ownerSub,
    name: r.name,
    hash: r.hash,
    scopes: r.scopes as readonly Scope[],
    agentIds: r.agentIds as readonly string[] | null,
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
    lastUsedAt: r.lastUsedAt,
    revokedAt: r.revokedAt,
  };
}

export function listApiKeysByOwner(db: Db) {
  return async (ownerSub: string): Promise<ApiKeyRow[]> => {
    const rows = await db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.ownerSub, ownerSub), isNull(apiKeys.revokedAt)))
      .orderBy(desc(apiKeys.createdAt));
    return rows.map(toRow);
  };
}

export function insertApiKey(db: Db) {
  return async (row: NewApiKey): Promise<ApiKeyRow> => {
    const [inserted] = await db
      .insert(apiKeys)
      .values({
        id: row.id,
        ownerSub: row.ownerSub,
        name: row.name,
        hash: row.hash,
        scopes: row.scopes as string[],
        agentIds: row.agentIds as string[] | null,
        expiresAt: row.expiresAt,
      })
      .returning();
    return toRow(inserted!);
  };
}

export function findActiveApiKeyByHash(db: Db) {
  return async (hash: string): Promise<ApiKeyRow | null> => {
    const rows = await db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.hash, hash), isNull(apiKeys.revokedAt)))
      .limit(1);
    return rows[0] ? toRow(rows[0]) : null;
  };
}

export function revokeApiKey(db: Db) {
  return async (id: string, ownerSub: string): Promise<boolean> => {
    const result = await db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(apiKeys.id, id),
          eq(apiKeys.ownerSub, ownerSub),
          isNull(apiKeys.revokedAt),
        ),
      )
      .returning({ id: apiKeys.id });
    return result.length > 0;
  };
}

export function touchApiKeyLastUsed(db: Db) {
  return async (id: string): Promise<void> => {
    await db
      .update(apiKeys)
      .set({ lastUsedAt: sql`now()` })
      .where(eq(apiKeys.id, id));
  };
}

/* UNIT_BOUNDARY_DESCRIPTION: whether one key is still live, asked by a Connection that names it, so a Connection whose key the owner revoked in Settings reads as expired rather than active. */
export function activeApiKeyIds(db: Db) {
  return async (ids: readonly string[]): Promise<Set<string>> => {
    if (ids.length === 0) return new Set();
    const rows = await db
      .select({ id: apiKeys.id })
      .from(apiKeys)
      .where(and(inArray(apiKeys.id, [...ids]), isNull(apiKeys.revokedAt)));
    return new Set(rows.map((r) => r.id));
  };
}

export function insertApiKeyRevocation(db: Db) {
  return async (
    keyId: string,
    ownerSub: string,
    connectionId: string | null,
  ): Promise<void> => {
    await db
      .insert(apiKeyRevocations)
      .values({ keyId, ownerSub, connectionId })
      .onConflictDoNothing();
  };
}

export function listApiKeyRevocations(db: Db) {
  return async (): Promise<
    { keyId: string; ownerSub: string; connectionId: string | null }[]
  > =>
    db
      .select({
        keyId: apiKeyRevocations.keyId,
        ownerSub: apiKeyRevocations.ownerSub,
        connectionId: apiKeyRevocations.connectionId,
      })
      .from(apiKeyRevocations);
}

export function listApiKeyRevocationsForConnection(db: Db) {
  return async (connectionId: string): Promise<string[]> => {
    const rows = await db
      .select({ keyId: apiKeyRevocations.keyId })
      .from(apiKeyRevocations)
      .where(eq(apiKeyRevocations.connectionId, connectionId));
    return rows.map((r) => r.keyId);
  };
}

export function deleteApiKeyRevocation(db: Db) {
  return async (keyId: string): Promise<void> => {
    await db
      .delete(apiKeyRevocations)
      .where(eq(apiKeyRevocations.keyId, keyId));
  };
}

export function deleteApiKeyRevocationsForConnection(db: Db) {
  return async (connectionId: string): Promise<void> => {
    await db
      .delete(apiKeyRevocations)
      .where(eq(apiKeyRevocations.connectionId, connectionId));
  };
}

/* UNIT_BOUNDARY_DESCRIPTION: whether any Connection's record names this key as the one it uses, read by the sweep so a key a Connection took over is never revoked for having been queued before that write landed. */
export function isApiKeyNamedByAConnection(db: Db) {
  return async (keyId: string): Promise<boolean> => {
    const rows = await db.execute<{ exists: number }>(sql`
      SELECT 1 AS exists FROM connections
      WHERE inputs->>'apiKeyId' = ${keyId}
      LIMIT 1`);
    return (rows as unknown as unknown[]).length > 0;
  };
}

export function removeAgentIdFromScopes(db: Db) {
  return async (agentId: string): Promise<void> => {
    await db
      .update(apiKeys)
      .set({ agentIds: sql`array_remove(${apiKeys.agentIds}, ${agentId})` })
      .where(sql`${agentId} = ANY(${apiKeys.agentIds})`);
  };
}

export function listScopedAgentIds(db: Db) {
  return async (): Promise<string[]> => {
    const rows = await db
      .selectDistinct({ agentId: sql<string>`unnest(${apiKeys.agentIds})` })
      .from(apiKeys);
    return rows.map((r) => r.agentId);
  };
}
