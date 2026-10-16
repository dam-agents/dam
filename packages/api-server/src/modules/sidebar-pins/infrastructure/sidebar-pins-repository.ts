import {
  and,
  asc,
  eq,
  type Db,
  sidebarAgentPins,
  sidebarSessionPins,
} from "db";
import type { SidebarPins } from "api-server-api";

export interface SidebarPinsRepository {
  find(owner: string): Promise<SidebarPins>;
  replaceAgents(owner: string, agentIds: readonly string[]): Promise<void>;
  replaceSessions(
    owner: string,
    agentId: string,
    sessionIds: readonly string[],
  ): Promise<void>;
  listAgentIds(): Promise<string[]>;
  deleteForAgent(agentId: string): Promise<void>;
}

export function createSidebarPinsRepository(db: Db): SidebarPinsRepository {
  return {
    async find(owner) {
      const [agentRows, sessionRows] = await Promise.all([
        db
          .select({ agentId: sidebarAgentPins.agentId })
          .from(sidebarAgentPins)
          .where(eq(sidebarAgentPins.owner, owner))
          .orderBy(asc(sidebarAgentPins.position)),
        db
          .select({
            agentId: sidebarSessionPins.agentId,
            sessionId: sidebarSessionPins.sessionId,
          })
          .from(sidebarSessionPins)
          .where(eq(sidebarSessionPins.owner, owner))
          .orderBy(asc(sidebarSessionPins.position)),
      ]);
      const sessions: Record<string, string[]> = {};
      for (const row of sessionRows)
        (sessions[row.agentId] ??= []).push(row.sessionId);
      return { agents: agentRows.map((row) => row.agentId), sessions };
    },

    async replaceAgents(owner, agentIds) {
      await db.transaction(async (tx) => {
        await tx
          .delete(sidebarAgentPins)
          .where(eq(sidebarAgentPins.owner, owner));
        if (agentIds.length === 0) return;
        await tx
          .insert(sidebarAgentPins)
          .values(
            agentIds.map((agentId, position) => ({ owner, agentId, position })),
          );
      });
    },

    async replaceSessions(owner, agentId, sessionIds) {
      await db.transaction(async (tx) => {
        await tx
          .delete(sidebarSessionPins)
          .where(
            and(
              eq(sidebarSessionPins.owner, owner),
              eq(sidebarSessionPins.agentId, agentId),
            ),
          );
        if (sessionIds.length === 0) return;
        await tx.insert(sidebarSessionPins).values(
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
          .selectDistinct({ agentId: sidebarAgentPins.agentId })
          .from(sidebarAgentPins),
        db
          .selectDistinct({ agentId: sidebarSessionPins.agentId })
          .from(sidebarSessionPins),
      ]);
      return [
        ...new Set([...agentRows, ...sessionRows].map((row) => row.agentId)),
      ];
    },

    async deleteForAgent(agentId) {
      await db.transaction(async (tx) => {
        await tx
          .delete(sidebarAgentPins)
          .where(eq(sidebarAgentPins.agentId, agentId));
        await tx
          .delete(sidebarSessionPins)
          .where(eq(sidebarSessionPins.agentId, agentId));
      });
    },
  };
}
