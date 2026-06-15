import type { Db } from "db";
import { apiKeys, and, desc, eq, isNull, sql } from "db";
import type { Scope } from "api-server-api";
import type { ApiKeyRow } from "../domain/types.js";

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
  return async (row: {
    id: string;
    ownerSub: string;
    name: string;
    hash: string;
    scopes: readonly Scope[];
    agentIds: readonly string[] | null;
    expiresAt: Date | null;
  }): Promise<ApiKeyRow> => {
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
