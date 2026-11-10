import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
  type Db,
  invocations as invocationsTable,
  invocationRuns as runsTable,
} from "db";
import type {
  InvocationHarnessConfig,
  InvocationOutput,
  InvocationOutputStream,
} from "api-server-api";

export type InvocationStatus = "idle" | "running" | "done" | "failed";

export type RunStatus = Exclude<InvocationStatus, "idle">;

export type InvocationOrigin = "tool" | "script";

export interface InvocationSpec {
  label: string | null;
  prompt: string;
  script: string | null;
  templateId: string | null;
  image: string | null;
  connections: string[];
  ttlMs: number | null;
}

// UNIT_BOUNDARY_DESCRIPTION: a target and one of its runs, as every reader sees it: the target's latest run when it is read by its id, each running run when runs are listed. A target with no run yet reads as idle, with the spawn's time limit and expiry.
export interface InvocationRow extends InvocationSpec {
  id: string;
  driverAgentId: string;
  rootDriverId: string;
  owner: string;
  resultSchema: unknown;
  result: unknown;
  status: InvocationStatus;
  errorReason: string | null;
  exitCode: number | null;
  output: InvocationOutput | null;
  outputExpiresAt: Date | null;
  createdAt: Date;
  runCreatedAt: Date | null;
  startedAt: Date | null;
  expiresAt: Date;
  keepUntil: Date | null;
  runId: string | null;
  sessionId: string | null;
  cancelPending: boolean;
  completedAt: Date | null;
  reapedAt: Date | null;
  transcriptCaptured: boolean;
  transcriptTruncated: boolean;
  harnessConfig: InvocationHarnessConfig | null;
  driverSessionId: string | null;
}

// UNIT_BOUNDARY_DESCRIPTION: one run in a target: the id of its task event, its task or script, the schema a task's result must match, its time limit, the caller its result goes to, and the target's session it continues, when it continues one.
export interface InvocationRun {
  runId: string;
  prompt: string;
  script: string | null;
  resultSchema: unknown;
  ttlMs: number;
  expiresAt: Date;
  origin: InvocationOrigin;
  driverSessionId: string | null;
  sessionId: string | null;
}

export interface InvocationStart {
  startedAt: Date;
  expiresAt: Date;
}

export type ScriptFinish =
  | {
      status: "done";
      exitCode: number;
      output: InvocationOutput;
      outputExpiresAt: Date | null;
    }
  | {
      status: "failed";
      exitCode: number | null;
      errorReason: string;
      output: InvocationOutput;
      outputExpiresAt: Date | null;
    };

export interface InvocationsRepository {
  insert(
    input: Omit<InvocationSpec, "prompt" | "script"> & {
      id: string;
      driverAgentId: string;
      rootDriverId: string;
      owner: string;
      expiresAt: Date;
      keepUntil?: Date | null;
      harnessConfig: InvocationHarnessConfig | null;
      driverSessionId?: string | null;
    },
    run: InvocationRun | null,
  ): Promise<void>;
  get(id: string): Promise<InvocationRow | null>;
  getRun(runId: string): Promise<InvocationRow | null>;
  // UNIT_BOUNDARY_DESCRIPTION: a run named by its own id, or a target's latest run named by the target's id, as a driver names either.
  find(id: string): Promise<InvocationRow | null>;
  listRuns(invocationId: string, limit: number): Promise<InvocationRow[]>;
  listRunningRuns(invocationId: string): Promise<InvocationRow[]>;
  listRunningRunsOf(invocationIds: readonly string[]): Promise<InvocationRow[]>;
  markStarted(
    invocationId: string,
    eventId: string,
    at: Date,
  ): Promise<InvocationStart | null>;
  complete(
    runId: string,
    result: unknown,
    sessionId: string | null,
  ): Promise<boolean>;
  fail(
    runId: string,
    reason: string,
    sessionId?: string | null,
  ): Promise<{ cancelPending: boolean } | null>;
  failExpired(
    runId: string,
    reason: string,
    now: Date,
  ): Promise<{ cancelPending: boolean } | null>;
  // UNIT_BOUNDARY_DESCRIPTION: fails a running run that was stopped; a collected one is never delivered to its driver as a turn and never wakes it, since nobody needs its outcome.
  failStopped(
    runId: string,
    reason: string,
    collected: boolean,
  ): Promise<{ cancelPending: boolean } | null>;
  finishScript(runId: string, finish: ScriptFinish): Promise<boolean>;
  dropOutputStream(
    runId: string,
    stream: InvocationOutputStream,
  ): Promise<void>;
  clearOutput(runId: string): Promise<void>;
  listExpiredOutputs(now: Date, limit: number): Promise<InvocationRow[]>;
  listScriptsByRoot(rootDriverId: string): Promise<InvocationRow[]>;
  listExpiredRunning(now: Date, limit: number): Promise<InvocationRow[]>;
  listRunning(limit: number): Promise<InvocationRow[]>;
  listRunningByDriver(driverAgentId: string): Promise<InvocationRow[]>;
  listUnreapedByDriver(driverAgentId: string): Promise<InvocationRow[]>;
  listRunningAgentIds(olderThan: Date): Promise<string[]>;
  listRootDriverIds(): Promise<string[]>;
  listTerminalUnreaped(before: Date, limit: number): Promise<InvocationRow[]>;
  hasRunning(invocationId: string): Promise<boolean>;
  markReaped(id: string): Promise<void>;
  setKeepUntil(id: string, keepUntil: Date): Promise<void>;
  // UNIT_BOUNDARY_DESCRIPTION: adds a run to a target that is kept, or a clean slate with no run yet whose wait has not run out; a run that continues a session is refused while another run works in that session or is still being ended there, checked under the target's lock so two runs never take one session.
  beginRun(
    invocationId: string,
    run: InvocationRun,
  ): Promise<"begun" | "unavailable" | "session-busy">;
  setRunSession(runId: string, sessionId: string): Promise<void>;
  listExpiredIdle(now: Date, limit: number): Promise<InvocationRow[]>;
  listCancelPending(limit: number): Promise<InvocationRow[]>;
  clearCancel(runId: string): Promise<void>;
  markTranscriptCaptured(id: string, truncated: boolean): Promise<void>;
  listByRoot(rootDriverId: string, limit: number): Promise<InvocationRow[]>;
  listUnreapedByRoot(rootDriverId: string): Promise<InvocationRow[]>;
  listTargetsByOwner(
    owner: string,
  ): Promise<{ driverAgentId: string; targetAgentId: string }[]>;
  delete(id: string): Promise<void>;
  deleteReapedByRoot(rootDriverId: string): Promise<number>;
}

type TargetRecord = typeof invocationsTable.$inferSelect;
type RunRecord = typeof runsTable.$inferSelect;

export function toRow(
  target: TargetRecord,
  run: RunRecord | null,
): InvocationRow {
  return {
    id: target.id,
    driverAgentId: target.driverAgentId,
    rootDriverId: target.rootDriverId,
    owner: target.owner,
    label: target.label,
    prompt: run?.prompt ?? "",
    script: run?.script ?? null,
    templateId: target.templateId,
    image: target.image,
    connections: target.connections,
    ttlMs: run?.ttlMs ?? target.ttlMs,
    resultSchema: run?.resultSchema ?? null,
    result: run?.result ?? null,
    status: (run?.status as RunStatus | undefined) ?? "idle",
    errorReason: run?.errorReason ?? null,
    exitCode: run?.exitCode ?? null,
    output: (run?.output as InvocationOutput | null | undefined) ?? null,
    outputExpiresAt: run?.outputExpiresAt ?? null,
    createdAt: target.createdAt,
    runCreatedAt: run?.createdAt ?? null,
    startedAt: run?.startedAt ?? null,
    expiresAt: run?.expiresAt ?? target.expiresAt,
    keepUntil: target.keepUntil,
    runId: run?.id ?? null,
    sessionId: run?.sessionId ?? null,
    cancelPending: run?.cancelPending ?? false,
    completedAt: run?.completedAt ?? null,
    reapedAt: target.reapedAt,
    transcriptCaptured: target.transcriptCaptured,
    transcriptTruncated: target.transcriptTruncated,
    harnessConfig: target.harnessConfig as InvocationHarnessConfig | null,
    driverSessionId: run?.driverSessionId ?? target.driverSessionId,
  };
}

const keepActive = sql<boolean>`(${invocationsTable.keepUntil} is not null and ${invocationsTable.keepUntil} > now())`;

const keptTarget = (invocationId: typeof runsTable.invocationId) =>
  sql<boolean>`exists (select 1 from ${invocationsTable} where ${invocationsTable.id} = ${invocationId} and ${keepActive})`;

const runningRun = sql<boolean>`exists (select 1 from ${runsTable} where ${runsTable.invocationId} = ${invocationsTable.id} and ${runsTable.status} = 'running')`;

const noRun = sql<boolean>`not exists (select 1 from ${runsTable} where ${runsTable.invocationId} = ${invocationsTable.id})`;

/**
 * UNIT_BOUNDARY_DESCRIPTION: the run an event of a target names: its own run,
 * or, for a target whose only run is from before runs had their own rows
 * (that run carries the target's id), that run, which no event names.
 */
const namedRun = (invocationId: string, eventId: string) =>
  and(
    eq(runsTable.invocationId, invocationId),
    or(eq(runsTable.id, eventId), eq(runsTable.id, invocationId)),
  );

export function createInvocationsRepository(db: Db): InvocationsRepository {
  async function latestRuns(
    invocationIds: readonly string[],
  ): Promise<Map<string, RunRecord>> {
    if (invocationIds.length === 0) return new Map();
    const rows = await db
      .selectDistinctOn([runsTable.invocationId])
      .from(runsTable)
      .where(inArray(runsTable.invocationId, [...invocationIds]))
      .orderBy(
        runsTable.invocationId,
        desc(runsTable.createdAt),
        desc(runsTable.id),
      );
    return new Map(rows.map((r) => [r.invocationId, r]));
  }

  async function withLatestRun(
    targets: TargetRecord[],
  ): Promise<InvocationRow[]> {
    const runs = await latestRuns(targets.map((t) => t.id));
    return targets.map((t) => toRow(t, runs.get(t.id) ?? null));
  }

  async function withTargets(runs: RunRecord[]): Promise<InvocationRow[]> {
    if (runs.length === 0) return [];
    const ids = [...new Set(runs.map((r) => r.invocationId))];
    const targets = await db
      .select()
      .from(invocationsTable)
      .where(inArray(invocationsTable.id, ids));
    const byId = new Map(targets.map((t) => [t.id, t]));
    return runs.flatMap((r) => {
      const target = byId.get(r.invocationId);
      return target ? [toRow(target, r)] : [];
    });
  }

  async function runRows(
    where: ReturnType<typeof and>,
    limit?: number,
  ): Promise<InvocationRow[]> {
    const query = db.select().from(runsTable).where(where);
    return withTargets(
      await (limit === undefined ? query : query.limit(limit)),
    );
  }

  async function failWith(
    where: ReturnType<typeof and>,
    reason: string,
    sessionId?: string | null,
    collected = false,
  ): Promise<{ cancelPending: boolean } | null> {
    const now = new Date();
    const rows = await db
      .update(runsTable)
      .set({
        status: "failed",
        errorReason: reason,
        completedAt: now,
        cancelPending: keptTarget(runsTable.invocationId),
        ...(sessionId
          ? { sessionId: sql`coalesce(${runsTable.sessionId}, ${sessionId})` }
          : {}),
        ...(collected ? { deliveredAt: now, wokeAt: now } : {}),
      })
      .where(and(where, eq(runsTable.status, "running")))
      .returning({ cancelPending: runsTable.cancelPending });
    return rows[0] ?? null;
  }

  const repo: InvocationsRepository = {
    async insert(input, run) {
      await db.transaction(async (tx) => {
        await tx.insert(invocationsTable).values({
          id: input.id,
          driverAgentId: input.driverAgentId,
          rootDriverId: input.rootDriverId,
          owner: input.owner,
          label: input.label,
          templateId: input.templateId,
          image: input.image,
          connections: input.connections,
          ttlMs: input.ttlMs,
          expiresAt: input.expiresAt,
          keepUntil: input.keepUntil ?? null,
          harnessConfig: input.harnessConfig,
          driverSessionId: input.driverSessionId ?? null,
        });
        if (run)
          await tx.insert(runsTable).values({
            id: run.runId,
            invocationId: input.id,
            prompt: run.prompt,
            script: run.script,
            resultSchema: run.resultSchema,
            ttlMs: run.ttlMs,
            expiresAt: run.expiresAt,
            origin: run.origin,
            driverSessionId: run.driverSessionId,
            sessionId: run.sessionId,
          });
      });
    },

    async get(id) {
      const rows = await db
        .select()
        .from(invocationsTable)
        .where(eq(invocationsTable.id, id))
        .limit(1);
      if (!rows[0]) return null;
      return (await withLatestRun(rows))[0]!;
    },

    async getRun(runId) {
      const rows = await runRows(and(eq(runsTable.id, runId)), 1);
      return rows[0] ?? null;
    },

    async find(id) {
      return (await repo.getRun(id)) ?? (await repo.get(id));
    },

    listRunningRuns(invocationId) {
      return runRows(
        and(
          eq(runsTable.invocationId, invocationId),
          eq(runsTable.status, "running"),
        ),
      );
    },

    async listRunningRunsOf(invocationIds) {
      if (invocationIds.length === 0) return [];
      return runRows(
        and(
          inArray(runsTable.invocationId, [...invocationIds]),
          eq(runsTable.status, "running"),
        ),
      );
    },

    async listRuns(invocationId, limit) {
      const runs = await db
        .select()
        .from(runsTable)
        .where(eq(runsTable.invocationId, invocationId))
        .orderBy(desc(runsTable.createdAt), desc(runsTable.id))
        .limit(limit);
      return withTargets(runs);
    },

    async markStarted(invocationId, eventId, at) {
      const startedAt = sql`${at.toISOString()}::timestamptz`;
      const rows = await db
        .update(runsTable)
        .set({
          startedAt: sql`coalesce(${runsTable.startedAt}, ${startedAt})`,
          expiresAt: sql`case when ${runsTable.startedAt} is null and ${runsTable.ttlMs} is not null then ${startedAt} + ${runsTable.ttlMs} * interval '1 millisecond' else ${runsTable.expiresAt} end`,
        })
        .where(
          and(namedRun(invocationId, eventId), eq(runsTable.status, "running")),
        )
        .returning({
          startedAt: runsTable.startedAt,
          expiresAt: runsTable.expiresAt,
        });
      const row = rows[0];
      return row?.startedAt
        ? { startedAt: row.startedAt, expiresAt: row.expiresAt }
        : null;
    },

    async complete(runId, result, sessionId) {
      const updated = await db
        .update(runsTable)
        .set({
          result,
          status: "done",
          completedAt: new Date(),
          ...(sessionId
            ? { sessionId: sql`coalesce(${runsTable.sessionId}, ${sessionId})` }
            : {}),
        })
        .where(and(eq(runsTable.id, runId), eq(runsTable.status, "running")))
        .returning({ id: runsTable.id });
      return updated.length > 0;
    },

    fail(runId, reason, sessionId) {
      return failWith(and(eq(runsTable.id, runId)), reason, sessionId);
    },

    failStopped(runId, reason, collected) {
      return failWith(and(eq(runsTable.id, runId)), reason, null, collected);
    },

    failExpired(runId, reason, now) {
      return failWith(
        and(eq(runsTable.id, runId), lt(runsTable.expiresAt, now)),
        reason,
      );
    },

    async finishScript(runId, finish) {
      const updated = await db
        .update(runsTable)
        .set({
          status: finish.status,
          exitCode: finish.exitCode,
          output: finish.output,
          outputExpiresAt: finish.outputExpiresAt,
          errorReason: finish.status === "failed" ? finish.errorReason : null,
          completedAt: new Date(),
        })
        .where(and(eq(runsTable.id, runId), eq(runsTable.status, "running")))
        .returning({ id: runsTable.id });
      return updated.length > 0;
    },

    async dropOutputStream(runId, stream) {
      const rest = sql`(${runsTable.output} - ${stream}::text)`;
      await db
        .update(runsTable)
        .set({
          output: sql`nullif(${rest}, '{}'::jsonb)`,
          outputExpiresAt: sql`case when ${rest} = '{}'::jsonb then null else ${runsTable.outputExpiresAt} end`,
        })
        .where(eq(runsTable.id, runId));
    },

    async clearOutput(runId) {
      await db
        .update(runsTable)
        .set({ output: null, outputExpiresAt: null })
        .where(eq(runsTable.id, runId));
    },

    listExpiredOutputs(now, limit) {
      return runRows(and(lte(runsTable.outputExpiresAt, now)), limit);
    },

    listScriptsByRoot(rootDriverId) {
      return runRows(
        and(
          isNotNull(runsTable.script),
          inArray(
            runsTable.invocationId,
            db
              .select({ id: invocationsTable.id })
              .from(invocationsTable)
              .where(eq(invocationsTable.rootDriverId, rootDriverId)),
          ),
        ),
      );
    },

    listExpiredRunning(now, limit) {
      return runRows(
        and(eq(runsTable.status, "running"), lt(runsTable.expiresAt, now)),
        limit,
      );
    },

    listRunning(limit) {
      return runRows(and(eq(runsTable.status, "running")), limit);
    },

    listRunningByDriver(driverAgentId) {
      return runRows(
        and(
          eq(runsTable.status, "running"),
          inArray(
            runsTable.invocationId,
            db
              .select({ id: invocationsTable.id })
              .from(invocationsTable)
              .where(eq(invocationsTable.driverAgentId, driverAgentId)),
          ),
        ),
      );
    },

    async listUnreapedByDriver(driverAgentId) {
      return withLatestRun(
        await db
          .select()
          .from(invocationsTable)
          .where(
            and(
              eq(invocationsTable.driverAgentId, driverAgentId),
              isNull(invocationsTable.reapedAt),
            ),
          ),
      );
    },

    async listRunningAgentIds(olderThan) {
      const rows = await db
        .select({
          id: invocationsTable.id,
          driverAgentId: invocationsTable.driverAgentId,
        })
        .from(invocationsTable)
        .where(and(lt(invocationsTable.createdAt, olderThan), runningRun));
      const ids = new Set<string>();
      for (const r of rows) {
        ids.add(r.id);
        ids.add(r.driverAgentId);
      }
      return Array.from(ids);
    },

    async listTerminalUnreaped(before, limit) {
      const lastEnd = sql`(select max(${runsTable.completedAt}) from ${runsTable} where ${runsTable.invocationId} = ${invocationsTable.id})`;
      return withLatestRun(
        await db
          .select()
          .from(invocationsTable)
          .where(
            and(
              isNull(invocationsTable.reapedAt),
              sql`not ${runningRun}`,
              sql`${lastEnd} < ${before.toISOString()}::timestamptz`,
              or(
                isNull(invocationsTable.keepUntil),
                lt(invocationsTable.keepUntil, new Date()),
              ),
            ),
          )
          .limit(limit),
      );
    },

    async hasRunning(invocationId) {
      const rows = await db
        .select({ id: runsTable.id })
        .from(runsTable)
        .where(
          and(
            eq(runsTable.invocationId, invocationId),
            eq(runsTable.status, "running"),
          ),
        )
        .limit(1);
      return rows.length > 0;
    },

    async beginRun(invocationId, run) {
      return db.transaction(async (tx) => {
        const locked = await tx
          .select({ id: invocationsTable.id })
          .from(invocationsTable)
          .where(
            and(
              eq(invocationsTable.id, invocationId),
              isNull(invocationsTable.reapedAt),
              or(
                sql`${keepActive}`,
                and(
                  isNull(invocationsTable.keepUntil),
                  sql`${invocationsTable.expiresAt} > now()`,
                  noRun,
                ),
              ),
            ),
          )
          .for("update");
        if (locked.length === 0) return "unavailable";
        if (run.sessionId) {
          const busy = await tx
            .select({ id: runsTable.id })
            .from(runsTable)
            .where(
              and(
                eq(runsTable.invocationId, invocationId),
                eq(runsTable.sessionId, run.sessionId),
                or(
                  eq(runsTable.status, "running"),
                  eq(runsTable.cancelPending, true),
                ),
              ),
            )
            .limit(1);
          if (busy.length > 0) return "session-busy";
        }
        await tx.insert(runsTable).values({
          id: run.runId,
          invocationId,
          prompt: run.prompt,
          script: run.script,
          resultSchema: run.resultSchema,
          ttlMs: run.ttlMs,
          expiresAt: run.expiresAt,
          origin: run.origin,
          driverSessionId: run.driverSessionId,
          sessionId: run.sessionId,
        });
        return "begun";
      });
    },

    async setRunSession(runId, sessionId) {
      await db
        .update(runsTable)
        .set({ sessionId })
        .where(and(eq(runsTable.id, runId), isNull(runsTable.sessionId)));
    },

    async listExpiredIdle(now, limit) {
      return withLatestRun(
        await db
          .select()
          .from(invocationsTable)
          .where(
            and(
              isNull(invocationsTable.reapedAt),
              noRun,
              or(
                and(
                  isNull(invocationsTable.keepUntil),
                  lt(invocationsTable.expiresAt, now),
                ),
                lt(invocationsTable.keepUntil, now),
              ),
            ),
          )
          .limit(limit),
      );
    },

    listCancelPending(limit) {
      return runRows(
        and(
          eq(runsTable.cancelPending, true),
          inArray(
            runsTable.invocationId,
            db
              .select({ id: invocationsTable.id })
              .from(invocationsTable)
              .where(isNull(invocationsTable.reapedAt)),
          ),
        ),
        limit,
      );
    },

    async clearCancel(runId) {
      await db
        .update(runsTable)
        .set({ cancelPending: false })
        .where(eq(runsTable.id, runId));
    },

    async setKeepUntil(id, keepUntil) {
      await db
        .update(invocationsTable)
        .set({ keepUntil })
        .where(eq(invocationsTable.id, id));
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
      const targets = await db
        .select()
        .from(invocationsTable)
        .where(eq(invocationsTable.rootDriverId, rootDriverId))
        .orderBy(desc(invocationsTable.createdAt))
        .limit(limit);
      return withLatestRun(targets.reverse());
    },

    async listUnreapedByRoot(rootDriverId) {
      return withLatestRun(
        await db
          .select()
          .from(invocationsTable)
          .where(
            and(
              eq(invocationsTable.rootDriverId, rootDriverId),
              isNull(invocationsTable.reapedAt),
            ),
          ),
      );
    },

    async listTargetsByOwner(owner) {
      return db
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
    },

    async delete(id) {
      await db.transaction(async (tx) => {
        await tx.delete(runsTable).where(eq(runsTable.invocationId, id));
        await tx.delete(invocationsTable).where(eq(invocationsTable.id, id));
      });
    },

    async deleteReapedByRoot(rootDriverId) {
      return db.transaction(async (tx) => {
        const reaped = and(
          eq(invocationsTable.rootDriverId, rootDriverId),
          isNotNull(invocationsTable.reapedAt),
        );
        await tx
          .delete(runsTable)
          .where(
            inArray(
              runsTable.invocationId,
              tx
                .select({ id: invocationsTable.id })
                .from(invocationsTable)
                .where(reaped),
            ),
          );
        const deleted = await tx
          .delete(invocationsTable)
          .where(reaped)
          .returning({ id: invocationsTable.id });
        return deleted.length;
      });
    },
  };
  return repo;
}
