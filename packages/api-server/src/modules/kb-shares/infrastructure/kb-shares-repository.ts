import { randomUUID } from "node:crypto";
import type { Db } from "db";
import { kbShares, and, desc, eq, isNotNull, lt, ne, or, sql } from "db";
import type { KbSharePublishState } from "api-server-api";
import type { StaleSnapshotEntry } from "../domain/snapshot.js";
import type { KbShareRow } from "../domain/types.js";

function toRow(r: typeof kbShares.$inferSelect): KbShareRow {
  return {
    id: r.id,
    agentId: r.agentId,
    owner: r.owner,
    secret: r.secret,
    publicName: r.publicName,
    roots: r.roots as readonly string[],
    status: r.status as KbShareRow["status"],
    snapshotId: r.snapshotId,
    snapshotManifestKey: r.snapshotManifestKey,
    snapshotCreatedAt: r.snapshotCreatedAt,
    documentCount: r.documentCount,
    totalSizeBytes: r.totalSizeBytes,
    publishState: r.publishState as KbSharePublishState,
    publishError: r.publishError,
    publishToken: r.publishToken,
    staleSnapshots: r.staleSnapshots as readonly StaleSnapshotEntry[],
    queryCount: r.queryCount,
    lastUsedAt: r.lastUsedAt,
    dirtyAt: r.dirtyAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

const activeByAgent = (agentId: string) =>
  and(eq(kbShares.agentId, agentId), eq(kbShares.status, "active"));

export function findActiveShareByAgent(db: Db) {
  return async (agentId: string): Promise<KbShareRow | null> => {
    const rows = await db
      .select()
      .from(kbShares)
      .where(activeByAgent(agentId))
      .limit(1);
    return rows[0] ? toRow(rows[0]) : null;
  };
}

export function insertShare(db: Db) {
  return async (row: {
    id: string;
    agentId: string;
    owner: string;
    secret: string;
    publicName: string | null;
    roots: readonly string[];
  }): Promise<KbShareRow> => {
    const [inserted] = await db
      .insert(kbShares)
      .values({
        id: row.id,
        agentId: row.agentId,
        owner: row.owner,
        secret: row.secret,
        publicName: row.publicName,
        roots: row.roots as string[],
      })
      .returning();
    return toRow(inserted!);
  };
}

export function updateSharePublicName(db: Db) {
  return async (agentId: string, publicName: string): Promise<boolean> => {
    const result = await db
      .update(kbShares)
      .set({ publicName, updatedAt: new Date() })
      .where(activeByAgent(agentId))
      .returning({ id: kbShares.id });
    return result.length > 0;
  };
}

export function updateShareRoots(db: Db) {
  return async (
    agentId: string,
    roots: readonly string[],
  ): Promise<boolean> => {
    const result = await db
      .update(kbShares)
      .set({ roots: [...roots], updatedAt: new Date() })
      .where(activeByAgent(agentId))
      .returning({ id: kbShares.id });
    return result.length > 0;
  };
}

export function updateShareSecret(db: Db) {
  return async (agentId: string, secret: string): Promise<boolean> => {
    const result = await db
      .update(kbShares)
      .set({ secret, updatedAt: new Date() })
      .where(activeByAgent(agentId))
      .returning({ id: kbShares.id });
    return result.length > 0;
  };
}

export function findActiveShareById(db: Db) {
  return async (rowId: string): Promise<KbShareRow | null> => {
    const rows = await db
      .select()
      .from(kbShares)
      .where(and(eq(kbShares.id, rowId), eq(kbShares.status, "active")))
      .limit(1);
    return rows[0] ? toRow(rows[0]) : null;
  };
}

export function touchShareLastUsed(db: Db) {
  return async (rowId: string): Promise<void> => {
    await db
      .update(kbShares)
      .set({ lastUsedAt: sql`now()` })
      .where(eq(kbShares.id, rowId));
  };
}

export function incrementShareQueryCount(db: Db) {
  return async (rowId: string): Promise<void> => {
    await db
      .update(kbShares)
      .set({
        queryCount: sql`${kbShares.queryCount} + 1`,
        lastUsedAt: sql`now()`,
      })
      .where(eq(kbShares.id, rowId));
  };
}

export function listActiveSharesByOwner(db: Db) {
  return async (owner: string): Promise<KbShareRow[]> => {
    const rows = await db
      .select()
      .from(kbShares)
      .where(and(eq(kbShares.owner, owner), eq(kbShares.status, "active")))
      .orderBy(desc(kbShares.createdAt));
    return rows.map(toRow);
  };
}

export function markShareDirty(db: Db) {
  return async (agentId: string): Promise<boolean> => {
    const result = await db
      .update(kbShares)
      .set({ dirtyAt: sql`now()` })
      .where(activeByAgent(agentId))
      .returning({ id: kbShares.id });
    return result.length > 0;
  };
}

export function findLatestShareByAgent(db: Db) {
  return async (agentId: string): Promise<KbShareRow | null> => {
    const rows = await db
      .select()
      .from(kbShares)
      .where(eq(kbShares.agentId, agentId))
      .orderBy(desc(kbShares.createdAt))
      .limit(1);
    return rows[0] ? toRow(rows[0]) : null;
  };
}

export function claimPublish(db: Db) {
  return async (
    agentId: string,
    opts: { roots?: readonly string[]; staleClaimMs: number },
  ): Promise<KbShareRow | null> => {
    const cutoff = new Date(Date.now() - opts.staleClaimMs);
    const [claimed] = await db
      .update(kbShares)
      .set({
        publishState: "publishing",
        publishError: null,
        publishToken: randomUUID(),
        updatedAt: new Date(),
        ...(opts.roots ? { roots: opts.roots as string[] } : {}),
      })
      .where(
        and(
          activeByAgent(agentId),
          or(
            ne(kbShares.publishState, "publishing"),
            lt(kbShares.updatedAt, cutoff),
          ),
        ),
      )
      .returning();
    return claimed ? toRow(claimed) : null;
  };
}

export function finishPublishSuccess(db: Db) {
  return async (
    agentId: string,
    result: {
      snapshotId: string;
      snapshotManifestKey: string;
      snapshotCreatedAt: Date;
      documentCount: number;
      totalSizeBytes: number;
      staleSnapshots: readonly StaleSnapshotEntry[];
    },
    expectedToken: string,
    claimStartedAt: Date,
  ): Promise<boolean> => {
    const updated = await db
      .update(kbShares)
      .set({
        snapshotId: result.snapshotId,
        snapshotManifestKey: result.snapshotManifestKey,
        snapshotCreatedAt: result.snapshotCreatedAt,
        documentCount: result.documentCount,
        totalSizeBytes: result.totalSizeBytes,
        staleSnapshots: result.staleSnapshots as StaleSnapshotEntry[],
        publishState: "idle",
        publishError: null,
        publishToken: null,
        dirtyAt: sql`CASE WHEN ${kbShares.dirtyAt} <= ${claimStartedAt.toISOString()}::timestamptz THEN NULL ELSE ${kbShares.dirtyAt} END`,
        updatedAt: new Date(),
      })
      .where(
        and(
          activeByAgent(agentId),
          eq(kbShares.publishState, "publishing"),
          eq(kbShares.publishToken, expectedToken),
        ),
      )
      .returning({ id: kbShares.id });
    return updated.length > 0;
  };
}

export function finishPublishFailure(db: Db) {
  return async (
    agentId: string,
    error: string,
    expectedToken: string,
  ): Promise<boolean> => {
    const updated = await db
      .update(kbShares)
      .set({
        publishState: "failed",
        publishError: error,
        publishToken: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          activeByAgent(agentId),
          eq(kbShares.publishState, "publishing"),
          eq(kbShares.publishToken, expectedToken),
        ),
      )
      .returning({ id: kbShares.id });
    return updated.length > 0;
  };
}

export function releasePublishClaim(db: Db) {
  return async (agentId: string, expectedToken: string): Promise<boolean> => {
    const updated = await db
      .update(kbShares)
      .set({
        publishState: "idle",
        publishError: null,
        publishToken: null,
        dirtyAt: sql`now()`,
        updatedAt: new Date(),
      })
      .where(
        and(
          activeByAgent(agentId),
          eq(kbShares.publishState, "publishing"),
          eq(kbShares.publishToken, expectedToken),
        ),
      )
      .returning({ id: kbShares.id });
    return updated.length > 0;
  };
}

export function clearSnapshotPointer(db: Db) {
  return async (rowId: string): Promise<void> => {
    await db
      .update(kbShares)
      .set({
        snapshotId: null,
        snapshotManifestKey: null,
        snapshotCreatedAt: null,
        documentCount: null,
        totalSizeBytes: null,
        staleSnapshots: [],
        updatedAt: new Date(),
      })
      .where(eq(kbShares.id, rowId));
  };
}

export function revokeShareByAgent(db: Db) {
  return async (agentId: string): Promise<KbShareRow | null> => {
    const result = await db
      .update(kbShares)
      .set({ status: "revoked", updatedAt: new Date() })
      .where(activeByAgent(agentId))
      .returning();
    return result[0] ? toRow(result[0]) : null;
  };
}

export function listDirtyActiveShares(db: Db) {
  return async (): Promise<KbShareRow[]> => {
    const rows = await db
      .select()
      .from(kbShares)
      .where(and(eq(kbShares.status, "active"), isNotNull(kbShares.dirtyAt)));
    return rows.map(toRow);
  };
}
