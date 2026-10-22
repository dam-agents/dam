import { delegationTitle } from "api-server-api";
import {
  and,
  eq,
  inArray,
  sql,
  type Db,
  invocations as invocationsTable,
} from "db";

const TASK_PREVIEW_CHARS = 1_000;

export interface InvocationTask {
  name: string;
  task: string;
}

export interface InvocationTasks {
  tasksOf(
    owner: string,
    agentIds: readonly string[],
  ): Promise<ReadonlyMap<string, InvocationTask>>;
}

export function createInvocationTasks(db: Db): InvocationTasks {
  return {
    async tasksOf(owner, agentIds) {
      if (agentIds.length === 0) return new Map();
      const rows = await db
        .select({
          id: invocationsTable.id,
          label: invocationsTable.label,
          prompt: sql<string>`left(coalesce(nullif(${invocationsTable.prompt}, ''), ${invocationsTable.script}, ''), ${TASK_PREVIEW_CHARS})`,
          cut: sql<boolean>`length(coalesce(nullif(${invocationsTable.prompt}, ''), ${invocationsTable.script}, '')) > ${TASK_PREVIEW_CHARS}`,
        })
        .from(invocationsTable)
        .where(
          and(
            eq(invocationsTable.owner, owner),
            inArray(invocationsTable.id, [...agentIds]),
          ),
        );
      return new Map(
        rows.map((row) => [
          row.id,
          {
            name: delegationTitle(row),
            task: row.cut ? `${row.prompt}…` : row.prompt,
          },
        ]),
      );
    },
  };
}
