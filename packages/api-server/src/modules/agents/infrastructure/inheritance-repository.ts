import type { Db } from "db";
import { agentInheritance, and, eq, ne } from "db";
import type { ChildInheritance } from "api-server-api";

export interface InheritanceRepository {
  record(agentId: string, inheritance: ChildInheritance): Promise<void>;
  childrenMirroringConnections(parentAgentId: string): Promise<string[]>;
  get(agentId: string): Promise<{
    parentAgentId: string;
    egressFrom: ChildInheritance["egressFrom"];
  } | null>;
  deleteForAgent(agentId: string): Promise<void>;
  listAgentIds(): Promise<string[]>;
  listOwnEgressAgentIds(): Promise<string[]>;
}

export function createInheritanceRepository(db: Db): InheritanceRepository {
  return {
    async record(agentId, inheritance) {
      await db
        .insert(agentInheritance)
        .values({
          agentId,
          parentAgentId: inheritance.parentAgentId,
          connectionsFrom: inheritance.connectionsFrom,
          egressFrom: inheritance.egressFrom,
        })
        .onConflictDoNothing();
    },

    async childrenMirroringConnections(parentAgentId) {
      const rows = await db
        .select({ agentId: agentInheritance.agentId })
        .from(agentInheritance)
        .where(
          and(
            eq(agentInheritance.parentAgentId, parentAgentId),
            eq(agentInheritance.connectionsFrom, "parent"),
          ),
        );
      return rows.map((r) => r.agentId);
    },

    async get(agentId) {
      const [row] = await db
        .select({
          parentAgentId: agentInheritance.parentAgentId,
          egressFrom: agentInheritance.egressFrom,
        })
        .from(agentInheritance)
        .where(eq(agentInheritance.agentId, agentId))
        .limit(1);
      return row
        ? {
            parentAgentId: row.parentAgentId,
            egressFrom: row.egressFrom as ChildInheritance["egressFrom"],
          }
        : null;
    },

    async deleteForAgent(agentId) {
      await db
        .delete(agentInheritance)
        .where(eq(agentInheritance.agentId, agentId));
    },

    async listOwnEgressAgentIds() {
      const rows = await db
        .select({ agentId: agentInheritance.agentId })
        .from(agentInheritance)
        .where(ne(agentInheritance.egressFrom, "parent"));
      return rows.map((r) => r.agentId);
    },

    async listAgentIds() {
      const rows = await db
        .select({ agentId: agentInheritance.agentId })
        .from(agentInheritance);
      return rows.map((r) => r.agentId);
    },
  };
}
