import type { Db } from "db";
import { agentPublicProfiles, channels, eq, isNull, sql } from "db";

export interface PublicAgentProfileRow {
  agentId: string;
  name: string;
  ownerSub: string;
}

export type PublicAgentProfileLookup =
  | { status: "live"; row: PublicAgentProfileRow }
  | { status: "deleted" }
  | { status: "missing" };

const tombstone = (agentId: string) => ({
  agentId,
  name: "",
  ownerSub: "",
  deletedAt: sql`NOW()`,
});

export function getProfile(db: Db) {
  return async (agentId: string): Promise<PublicAgentProfileLookup> => {
    const rows = await db
      .select({
        agentId: agentPublicProfiles.agentId,
        name: agentPublicProfiles.name,
        ownerSub: agentPublicProfiles.ownerSub,
        deletedAt: agentPublicProfiles.deletedAt,
      })
      .from(agentPublicProfiles)
      .where(eq(agentPublicProfiles.agentId, agentId))
      .limit(1);
    const row = rows[0];
    if (!row) return { status: "missing" };
    if (row.deletedAt) return { status: "deleted" };
    return {
      status: "live",
      row: { agentId: row.agentId, name: row.name, ownerSub: row.ownerSub },
    };
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
      .insert(agentPublicProfiles)
      .values(tombstone(agentId))
      .onConflictDoUpdate({
        target: agentPublicProfiles.agentId,
        set: { deletedAt: sql`NOW()` },
      });
  };
}

export function listProfileIdsForReconcile(db: Db) {
  return async (): Promise<string[]> => {
    const rows = await db
      .selectDistinct({ agentId: agentPublicProfiles.agentId })
      .from(agentPublicProfiles)
      .innerJoin(channels, eq(channels.agentId, agentPublicProfiles.agentId))
      .where(isNull(agentPublicProfiles.deletedAt))
      .orderBy(agentPublicProfiles.agentId);
    return rows.map((r) => r.agentId);
  };
}
