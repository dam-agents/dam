import type { Db } from "db";
import { agentEnv, eq, inArray } from "db";
import type { EnvVar } from "api-server-api";

/** Postgres store for user-typed agent env, keyed by `agent_id` (ownership enforced by the agents service). */
export interface AgentEnvRepository {
  list(agentId: string): Promise<EnvVar[]>;
  /** Batched form; every input id is present in the map. */
  listMany(agentIds: string[]): Promise<Map<string, EnvVar[]>>;
  /** Replace an agent's full env set (the editor sends the complete list). */
  replace(agentId: string, env: EnvVar[]): Promise<void>;
  deleteForAgent(agentId: string): Promise<void>;
  /** Distinct agent ids with env rows, for the orphan sweeper. */
  listAgentIds(): Promise<string[]>;
}

export function createAgentEnvRepository(db: Db): AgentEnvRepository {
  return {
    async list(agentId) {
      const rows = await db
        .select({ name: agentEnv.name, value: agentEnv.value })
        .from(agentEnv)
        .where(eq(agentEnv.agentId, agentId));
      return rows.map((r) => ({ name: r.name, value: r.value }));
    },

    async listMany(agentIds) {
      const map = new Map<string, EnvVar[]>();
      for (const id of agentIds) map.set(id, []);
      if (agentIds.length === 0) return map;
      const rows = await db
        .select({
          agentId: agentEnv.agentId,
          name: agentEnv.name,
          value: agentEnv.value,
        })
        .from(agentEnv)
        .where(inArray(agentEnv.agentId, agentIds));
      for (const r of rows) {
        map.get(r.agentId)?.push({ name: r.name, value: r.value });
      }
      return map;
    },

    async replace(agentId, env) {
      // Dedupe by name (last wins) so a doubly-typed key can't violate the PK.
      const byName = new Map<string, string>();
      for (const e of env) byName.set(e.name, e.value);
      const rows = [...byName].map(([name, value]) => ({
        agentId,
        name,
        value,
      }));
      await db.transaction(async (tx) => {
        await tx.delete(agentEnv).where(eq(agentEnv.agentId, agentId));
        if (rows.length > 0) await tx.insert(agentEnv).values(rows);
      });
    },

    async deleteForAgent(agentId) {
      await db.delete(agentEnv).where(eq(agentEnv.agentId, agentId));
    },

    async listAgentIds() {
      const rows = await db
        .selectDistinct({ agentId: agentEnv.agentId })
        .from(agentEnv);
      return rows.map((r) => r.agentId);
    },
  };
}
