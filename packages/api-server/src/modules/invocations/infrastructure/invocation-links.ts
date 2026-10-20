import { desc, eq, type Db, invocations as invocationsTable } from "db";

export interface InvocationLink {
  id: string;
  driverAgentId: string;
  driverSessionId: string | null;
}

export interface InvocationLinks {
  listByRoot(rootDriverId: string, limit: number): Promise<InvocationLink[]>;
}

export function createInvocationLinks(db: Db): InvocationLinks {
  return {
    async listByRoot(rootDriverId, limit) {
      return db
        .select({
          id: invocationsTable.id,
          driverAgentId: invocationsTable.driverAgentId,
          driverSessionId: invocationsTable.driverSessionId,
        })
        .from(invocationsTable)
        .where(eq(invocationsTable.rootDriverId, rootDriverId))
        .orderBy(desc(invocationsTable.createdAt))
        .limit(limit);
    },
  };
}
