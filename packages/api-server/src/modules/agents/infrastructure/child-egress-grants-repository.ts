import type { Db } from "db";
import { agentChildEgressGrants, eq } from "db";

export interface ChildEgressGrantsRepository {
  isGranted(agentId: string): Promise<boolean>;
  set(agentId: string, on: boolean, decidedBy: string): Promise<void>;
  deleteForAgent(agentId: string): Promise<void>;
  listAgentIds(): Promise<string[]>;
}

export function createChildEgressGrantsRepository(
  db: Db,
): ChildEgressGrantsRepository {
  return {
    async isGranted(agentId) {
      const [row] = await db
        .select({ agentId: agentChildEgressGrants.agentId })
        .from(agentChildEgressGrants)
        .where(eq(agentChildEgressGrants.agentId, agentId))
        .limit(1);
      return row !== undefined;
    },

    async set(agentId, on, decidedBy) {
      if (!on) {
        await db
          .delete(agentChildEgressGrants)
          .where(eq(agentChildEgressGrants.agentId, agentId));
        return;
      }
      await db
        .insert(agentChildEgressGrants)
        .values({ agentId, grantedBy: decidedBy })
        .onConflictDoNothing();
    },

    async deleteForAgent(agentId) {
      await db
        .delete(agentChildEgressGrants)
        .where(eq(agentChildEgressGrants.agentId, agentId));
    },

    async listAgentIds() {
      const rows = await db
        .select({ agentId: agentChildEgressGrants.agentId })
        .from(agentChildEgressGrants);
      return rows.map((r) => r.agentId);
    },
  };
}
