import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  sql,
  type Db,
  invocations as invocationsTable,
} from "db";

export type InvocationStatus = "running" | "done" | "failed";

export interface InvocationSpec {
  label: string | null;
  prompt: string;
  templateId: string | null;
  image: string | null;
  connections: string[];
  cpu: string | null;
  memory: string | null;
  ttlMs: number | null;
}

export interface InvocationRow extends InvocationSpec {
  id: string;
  driverAgentId: string;
  rootDriverId: string;
  owner: string;
  resultSchema: unknown;
  result: unknown;
  status: InvocationStatus;
  errorReason: string | null;
  createdAt: Date;
  expiresAt: Date;
  completedAt: Date | null;
  reapedAt: Date | null;
  transcriptCaptured: boolean;
  transcriptTruncated: boolean;
}

export interface InvocationsRepository {
  insert(
    input: InvocationSpec & {
      id: string;
      driverAgentId: string;
      rootDriverId: string;
      owner: string;
      resultSchema: unknown;
      expiresAt: Date;
    },
  ): Promise<void>;
  get(id: string): Promise<InvocationRow | null>;
  complete(id: string, result: unknown): Promise<boolean>;
  fail(id: string, reason: string): Promise<void>;
  listExpiredRunning(now: Date, limit: number): Promise<InvocationRow[]>;
  listRunning(limit: number): Promise<InvocationRow[]>;
  listRunningByDriver(driverAgentId: string): Promise<InvocationRow[]>;
  listRunningAgentIds(olderThan: Date): Promise<string[]>;
  listRootDriverIds(): Promise<string[]>;
  listTerminalUnreaped(before: Date, limit: number): Promise<InvocationRow[]>;
  markReaped(id: string): Promise<void>;
  markTranscriptCaptured(id: string, truncated: boolean): Promise<void>;
  listByRoot(rootDriverId: string, limit: number): Promise<InvocationRow[]>;
  listUnreapedByRoot(rootDriverId: string): Promise<InvocationRow[]>;
  listTargetsByOwner(
    owner: string,
  ): Promise<{ driverAgentId: string; targetAgentId: string }[]>;
  delete(id: string): Promise<void>;
  deleteReapedByRoot(rootDriverId: string): Promise<number>;
}

function toRow(r: typeof invocationsTable.$inferSelect): InvocationRow {
  return {
    id: r.id,
    driverAgentId: r.driverAgentId,
    rootDriverId: r.rootDriverId,
    owner: r.owner,
    label: r.label,
    prompt: r.prompt,
    templateId: r.templateId,
    image: r.image,
    connections: r.connections,
    cpu: r.cpu,
    memory: r.memory,
    ttlMs: r.ttlMs,
    resultSchema: r.resultSchema,
    result: r.result,
    status: r.status as InvocationStatus,
    errorReason: r.errorReason,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    completedAt: r.completedAt,
    reapedAt: r.reapedAt,
    transcriptCaptured: r.transcriptCaptured,
    transcriptTruncated: r.transcriptTruncated,
  };
}

export function createInvocationsRepository(db: Db): InvocationsRepository {
  return {
    async insert(input) {
      await db.insert(invocationsTable).values({
        id: input.id,
        driverAgentId: input.driverAgentId,
        rootDriverId: input.rootDriverId,
        owner: input.owner,
        label: input.label,
        prompt: input.prompt,
        templateId: input.templateId,
        image: input.image,
        connections: input.connections,
        cpu: input.cpu,
        memory: input.memory,
        ttlMs: input.ttlMs,
        resultSchema: input.resultSchema,
        status: "running",
        expiresAt: input.expiresAt,
      });
    },

    async get(id) {
      const rows = await db
        .select()
        .from(invocationsTable)
        .where(eq(invocationsTable.id, id))
        .limit(1);
      return rows[0] ? toRow(rows[0]) : null;
    },

    async complete(id, result) {
      const updated = await db
        .update(invocationsTable)
        .set({ result, status: "done", completedAt: new Date() })
        .where(
          and(
            eq(invocationsTable.id, id),
            eq(invocationsTable.status, "running"),
          ),
        )
        .returning({ id: invocationsTable.id });
      return updated.length > 0;
    },

    async fail(id, reason) {
      await db
        .update(invocationsTable)
        .set({ status: "failed", errorReason: reason, completedAt: new Date() })
        .where(
          and(
            eq(invocationsTable.id, id),
            eq(invocationsTable.status, "running"),
          ),
        );
    },

    async listExpiredRunning(now, limit) {
      const rows = await db
        .select()
        .from(invocationsTable)
        .where(
          and(
            eq(invocationsTable.status, "running"),
            lt(invocationsTable.expiresAt, now),
          ),
        )
        .limit(limit);
      return rows.map(toRow);
    },

    async listRunning(limit) {
      const rows = await db
        .select()
        .from(invocationsTable)
        .where(eq(invocationsTable.status, "running"))
        .limit(limit);
      return rows.map(toRow);
    },

    async listRunningByDriver(driverAgentId) {
      const rows = await db
        .select()
        .from(invocationsTable)
        .where(
          and(
            eq(invocationsTable.status, "running"),
            eq(invocationsTable.driverAgentId, driverAgentId),
          ),
        );
      return rows.map(toRow);
    },

    async listRunningAgentIds(olderThan) {
      const rows = await db
        .select({
          id: invocationsTable.id,
          driverAgentId: invocationsTable.driverAgentId,
        })
        .from(invocationsTable)
        .where(
          and(
            eq(invocationsTable.status, "running"),
            lt(invocationsTable.createdAt, olderThan),
          ),
        );
      const ids = new Set<string>();
      for (const r of rows) {
        ids.add(r.id);
        ids.add(r.driverAgentId);
      }
      return Array.from(ids);
    },

    async listTerminalUnreaped(before, limit) {
      const rows = await db
        .select()
        .from(invocationsTable)
        .where(
          and(
            inArray(invocationsTable.status, ["done", "failed"]),
            isNull(invocationsTable.reapedAt),
            lt(invocationsTable.completedAt, before),
          ),
        )
        .limit(limit);
      return rows.map(toRow);
    },

    async markReaped(id) {
      await db
        .update(invocationsTable)
        .set({ reapedAt: new Date() })
        .where(eq(invocationsTable.id, id));
    },

    async markTranscriptCaptured(id, truncated) {
      await db
        .update(invocationsTable)
        .set({ transcriptCaptured: true, transcriptTruncated: truncated })
        .where(eq(invocationsTable.id, id));
    },

    async listRootDriverIds() {
      const rows = await db
        .selectDistinct({ rootDriverId: invocationsTable.rootDriverId })
        .from(invocationsTable);
      return rows.map((r) => r.rootDriverId);
    },

    async listByRoot(rootDriverId, limit) {
      const rows = await db
        .select()
        .from(invocationsTable)
        .where(eq(invocationsTable.rootDriverId, rootDriverId))
        .orderBy(desc(invocationsTable.createdAt))
        .limit(limit);
      return rows.reverse().map(toRow);
    },

    async listUnreapedByRoot(rootDriverId) {
      const rows = await db
        .select()
        .from(invocationsTable)
        .where(
          and(
            eq(invocationsTable.rootDriverId, rootDriverId),
            isNull(invocationsTable.reapedAt),
          ),
        );
      return rows.map(toRow);
    },

    async listTargetsByOwner(owner) {
      const rows = await db
        .select({
          driverAgentId: invocationsTable.driverAgentId,
          targetAgentId: invocationsTable.id,
        })
        .from(invocationsTable)
        .where(
          and(
            eq(invocationsTable.owner, owner),
            isNull(invocationsTable.reapedAt),
          ),
        );
      return rows;
    },

    async delete(id) {
      await db.delete(invocationsTable).where(eq(invocationsTable.id, id));
    },

    async deleteReapedByRoot(rootDriverId) {
      const deleted = await db
        .delete(invocationsTable)
        .where(
          and(
            eq(invocationsTable.rootDriverId, rootDriverId),
            isNotNull(invocationsTable.reapedAt),
          ),
        )
        .returning({ id: invocationsTable.id });
      return deleted.length;
    },
  };
}
