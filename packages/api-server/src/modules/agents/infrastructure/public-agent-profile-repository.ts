import type { Db } from "db";
import { agentPublicProfiles, and, eq, isNull, sql } from "db";

export interface PublicAgentProfileRow {
  agentId: string;
  name: string;
  ownerSub: string;
}

const live = (agentId: string) =>
  and(
    eq(agentPublicProfiles.agentId, agentId),
    isNull(agentPublicProfiles.deletedAt),
  );

export function getProfile(db: Db) {
  return async (agentId: string): Promise<PublicAgentProfileRow | null> => {
    const rows = await db
      .select({
        agentId: agentPublicProfiles.agentId,
        name: agentPublicProfiles.name,
        ownerSub: agentPublicProfiles.ownerSub,
      })
      .from(agentPublicProfiles)
      .where(live(agentId))
      .limit(1);
    return rows[0] ?? null;
  };
}

export function upsertProfile(db: Db) {
  return async (row: PublicAgentProfileRow): Promise<void> => {
    await db
      .insert(agentPublicProfiles)
      .values(row)
      .onConflictDoUpdate({
        target: agentPublicProfiles.agentId,
        set: {
          name: row.name,
          ownerSub: row.ownerSub,
          refreshedAt: sql`NOW()`,
          deletedAt: null,
        },
      });
  };
}

export function markProfileDeleted(db: Db) {
  return async (agentId: string): Promise<void> => {
    await db
      .update(agentPublicProfiles)
      .set({ deletedAt: sql`NOW()` })
      .where(live(agentId));
  };
}

export function listProfileIdsForReconcile(db: Db) {
  return async (): Promise<string[]> => {
    const rows = await db
      .select({ agentId: agentPublicProfiles.agentId })
      .from(agentPublicProfiles)
      .where(isNull(agentPublicProfiles.deletedAt))
      .orderBy(agentPublicProfiles.agentId);
    return rows.map((r) => r.agentId);
  };
}
