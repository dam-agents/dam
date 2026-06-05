import { agentWorkspace, eq, type Db } from "db";

/** Per-agent working-directory seed (one row per agent). Written at create time;
 *  the runtime state-builder projects it to a `workspace-git` Contribution. */
export interface AgentWorkspaceRepository {
  set(agentId: string, sourceUrl: string): Promise<void>;
  deleteByAgent(agentId: string): Promise<void>;
  listAgentIds(): Promise<string[]>;
}

export function createAgentWorkspaceRepository(
  db: Db,
): AgentWorkspaceRepository {
  return {
    async set(agentId, sourceUrl) {
      await db
        .insert(agentWorkspace)
        .values({ agentId, sourceUrl })
        .onConflictDoUpdate({
          target: agentWorkspace.agentId,
          set: { sourceUrl },
        });
    },
    async deleteByAgent(agentId) {
      await db
        .delete(agentWorkspace)
        .where(eq(agentWorkspace.agentId, agentId));
    },
    async listAgentIds() {
      const rows = await db
        .select({ agentId: agentWorkspace.agentId })
        .from(agentWorkspace);
      return rows.map((r) => r.agentId);
    },
  };
}
