import { delegationTitle } from "api-server-api";
import { and, eq, inArray, type Db, invocations as invocationsTable } from "db";

export interface InvocationTitles {
  titlesOf(
    owner: string,
    agentIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>>;
}

export function createInvocationTitles(db: Db): InvocationTitles {
  return {
    async titlesOf(owner, agentIds) {
      if (agentIds.length === 0) return new Map();
      const rows = await db
        .select({ id: invocationsTable.id, prompt: invocationsTable.prompt })
        .from(invocationsTable)
        .where(
          and(
            eq(invocationsTable.owner, owner),
            inArray(invocationsTable.id, [...agentIds]),
          ),
        );
      return new Map(
        rows
          .map((row) => [row.id, delegationTitle(row.prompt)] as const)
          .filter(([, title]) => title !== ""),
      );
    },
  };
}
