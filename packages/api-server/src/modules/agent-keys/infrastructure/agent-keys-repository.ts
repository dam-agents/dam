import { agentKeys, eq, type Db } from "db";

export interface AgentKeyRow {
  agentId: string;
  ownerSub: string;
}

export interface AgentKeysRepository {
  put(agentId: string, ownerSub: string, hash: string): Promise<void>;
  findByHash(hash: string): Promise<AgentKeyRow | null>;
  has(agentId: string): Promise<boolean>;
  delete(agentId: string): Promise<void>;
  listAgentIds(): Promise<string[]>;
}

// UNIT_BOUNDARY_DESCRIPTION: one Agent Key per Agent, as a hash; writing one replaces the Agent's last, so a restored rule gets a new key and the old one opens nothing.
export function createAgentKeysRepository(db: Db): AgentKeysRepository {
  return {
    async put(agentId, ownerSub, hash) {
      await db
        .insert(agentKeys)
        .values({ agentId, ownerSub, hash })
        .onConflictDoUpdate({
          target: agentKeys.agentId,
          set: { ownerSub, hash, createdAt: new Date() },
        });
    },

    async findByHash(hash) {
      const rows = await db
        .select({ agentId: agentKeys.agentId, ownerSub: agentKeys.ownerSub })
        .from(agentKeys)
        .where(eq(agentKeys.hash, hash))
        .limit(1);
      return rows[0] ?? null;
    },

    async has(agentId) {
      const rows = await db
        .select({ agentId: agentKeys.agentId })
        .from(agentKeys)
        .where(eq(agentKeys.agentId, agentId))
        .limit(1);
      return rows.length > 0;
    },

    async delete(agentId) {
      await db.delete(agentKeys).where(eq(agentKeys.agentId, agentId));
    },

    async listAgentIds() {
      const rows = await db
        .select({ agentId: agentKeys.agentId })
        .from(agentKeys);
      return rows.map((r) => r.agentId);
    },
  };
}
