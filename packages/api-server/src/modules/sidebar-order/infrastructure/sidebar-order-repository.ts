import {
  and,
  asc,
  eq,
  type Db,
  sidebarAgentOrder,
  sidebarSessionOrder,
} from "db";
import type { SidebarOrder } from "api-server-api";

export interface SidebarOrderRepository {
  find(owner: string): Promise<SidebarOrder>;
  replaceAgents(owner: string, agentIds: readonly string[]): Promise<void>;
  replaceSessions(
    owner: string,
    agentId: string,
    sessionIds: readonly string[],
  ): Promise<void>;
  listAgentIds(): Promise<string[]>;
  deleteForAgent(agentId: string): Promise<void>;
}

export function createSidebarOrderRepository(db: Db): SidebarOrderRepository {
  return {
    async find(owner) {
      const [agentRows, sessionRows] = await Promise.all([
        db
          .select({ agentId: sidebarAgentOrder.agentId })
          .from(sidebarAgentOrder)
          .where(eq(sidebarAgentOrder.owner, owner))
          .orderBy(asc(sidebarAgentOrder.position)),
        db
          .select({
            agentId: sidebarSessionOrder.agentId,
            sessionId: sidebarSessionOrder.sessionId,
          })
          .from(sidebarSessionOrder)
          .where(eq(sidebarSessionOrder.owner, owner))
          .orderBy(asc(sidebarSessionOrder.position)),
      ]);
      const sessions: Record<string, string[]> = {};
      for (const row of sessionRows)
        (sessions[row.agentId] ??= []).push(row.sessionId);
      return { agents: agentRows.map((row) => row.agentId), sessions };
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

    async replaceSessions(owner, agentId, sessionIds) {
      await db.transaction(async (tx) => {
        await tx
          .delete(sidebarSessionOrder)
          .where(
            and(
              eq(sidebarSessionOrder.owner, owner),
              eq(sidebarSessionOrder.agentId, agentId),
            ),
          );
        if (sessionIds.length === 0) return;
        await tx.insert(sidebarSessionOrder).values(
          sessionIds.map((sessionId, position) => ({
            owner,
            agentId,
            sessionId,
            position,
          })),
        );
      });
    },

    async listAgentIds() {
      const [agentRows, sessionRows] = await Promise.all([
        db
          .selectDistinct({ agentId: sidebarAgentOrder.agentId })
          .from(sidebarAgentOrder),
        db
          .selectDistinct({ agentId: sidebarSessionOrder.agentId })
          .from(sidebarSessionOrder),
      ]);
      return [
        ...new Set([...agentRows, ...sessionRows].map((row) => row.agentId)),
      ];
    },

    async deleteForAgent(agentId) {
      await db.transaction(async (tx) => {
        await tx
          .delete(sidebarAgentOrder)
          .where(eq(sidebarAgentOrder.agentId, agentId));
        await tx
          .delete(sidebarSessionOrder)
          .where(eq(sidebarSessionOrder.agentId, agentId));
      });
    },
  };
}
