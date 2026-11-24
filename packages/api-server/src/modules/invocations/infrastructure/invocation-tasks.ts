import { delegationTitle } from "api-server-api";
import {
  and,
  desc,
  eq,
  inArray,
  sql,
  type Db,
  invocations as invocationsTable,
  invocationRuns as runsTable,
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
      const targets = await db
        .select({ id: invocationsTable.id, label: invocationsTable.label })
        .from(invocationsTable)
        .where(
          and(
            eq(invocationsTable.owner, owner),
            inArray(invocationsTable.id, [...agentIds]),
          ),
        );
      if (targets.length === 0) return new Map();
      const work = sql<string>`coalesce(nullif(${runsTable.prompt}, ''), ${runsTable.script}, '')`;
      const latest = await db
        .selectDistinctOn([runsTable.invocationId], {
          invocationId: runsTable.invocationId,
          prompt: sql<string>`left(${work}, ${TASK_PREVIEW_CHARS})`,
          cut: sql<boolean>`length(${work}) > ${TASK_PREVIEW_CHARS}`,
        })
        .from(runsTable)
        .where(
          inArray(
            runsTable.invocationId,
            targets.map((t) => t.id),
          ),
        )
        .orderBy(
          runsTable.invocationId,
          desc(runsTable.createdAt),
          desc(runsTable.id),
        );
      const runs = new Map(latest.map((r) => [r.invocationId, r]));
      const rows = targets.map((t) => ({
        ...t,
        prompt: runs.get(t.id)?.prompt ?? "",
        cut: runs.get(t.id)?.cut ?? false,
      }));
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
