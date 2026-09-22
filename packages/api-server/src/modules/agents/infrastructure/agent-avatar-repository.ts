import type { Db } from "db";
import { agentAvatars, eq, inArray, sql } from "db";

export interface AgentAvatarRepository {
  readMany(agentIds: readonly string[]): Promise<Map<string, string>>;
  set(agentId: string, seed: string): Promise<void>;
  deleteForAgent(agentId: string): Promise<void>;
  listAgentIds(): Promise<string[]>;
}

export function createAgentAvatarRepository(db: Db): AgentAvatarRepository {
  return {
    async readMany(agentIds) {
      const out = new Map<string, string>();
      if (agentIds.length === 0) return out;
      const rows = await db
        .select({ agentId: agentAvatars.agentId, seed: agentAvatars.seed })
        .from(agentAvatars)
        .where(inArray(agentAvatars.agentId, [...agentIds]));
      for (const row of rows) out.set(row.agentId, row.seed);
      return out;
    },

    async set(agentId, seed) {
      await db
        .insert(agentAvatars)
        .values({ agentId, seed })
        .onConflictDoUpdate({
          target: agentAvatars.agentId,
          set: { seed, updatedAt: sql`NOW()` },
        });
    },

    async deleteForAgent(agentId) {
      await db.delete(agentAvatars).where(eq(agentAvatars.agentId, agentId));
    },

    async listAgentIds() {
      const rows = await db
        .select({ agentId: agentAvatars.agentId })
        .from(agentAvatars);
      return rows.map((r) => r.agentId);
    },
  };
}
