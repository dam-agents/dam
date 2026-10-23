import { asc, eq, type Db, sidebarAgentOrder } from "db";
import type { SidebarOrder } from "api-server-api";

export interface SidebarOrderRepository {
  find(owner: string): Promise<SidebarOrder>;
  replaceAgents(owner: string, agentIds: readonly string[]): Promise<void>;
  listAgentIds(): Promise<string[]>;
  deleteForAgent(agentId: string): Promise<void>;
}

export function createSidebarOrderRepository(db: Db): SidebarOrderRepository {
  return {
    async find(owner) {
      const rows = await db
        .select({ agentId: sidebarAgentOrder.agentId })
        .from(sidebarAgentOrder)
        .where(eq(sidebarAgentOrder.owner, owner))
        .orderBy(asc(sidebarAgentOrder.position));
      return { agents: rows.map((row) => row.agentId) };
    },

    async replaceAgents(owner, agentIds) {
      await db.transaction(async (tx) => {
        await tx
          .delete(sidebarAgentOrder)
          .where(eq(sidebarAgentOrder.owner, owner));
        if (agentIds.length === 0) return;
        await tx
          .insert(sidebarAgentOrder)
          .values(
            agentIds.map((agentId, position) => ({ owner, agentId, position })),
          );
      });
    },

    async listAgentIds() {
      const rows = await db
        .selectDistinct({ agentId: sidebarAgentOrder.agentId })
        .from(sidebarAgentOrder);
      return rows.map((row) => row.agentId);
    },

    async deleteForAgent(agentId) {
      await db
        .delete(sidebarAgentOrder)
        .where(eq(sidebarAgentOrder.agentId, agentId));
    },
  };
}
