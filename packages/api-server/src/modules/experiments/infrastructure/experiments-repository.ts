import {
  and,
  asc,
  desc,
  eq,
  lt,
  isNull,
  or,
  sql,
  type Db,
  experiments as experimentsTable,
  experimentSpans as spansTable,
} from "db";
import type { ExperimentStatus, Skeleton, SpanStatus } from "api-server-api";

export interface ExperimentRow {
  id: string;
  owner: string;
  driverAgentId: string;
  name: string;
  status: ExperimentStatus;
  skeleton: Skeleton;
  drift: string[];
  customData: Record<string, unknown> | null;
  attachedArtifactIds: string[];
  scriptPath: string;
  scriptSha256: string;
  scriptArtifactId: string;
  scriptVersion: number;
  dashboardArtifactId: string | null;
  error: string | null;
  createdAt: Date;
  executedAt: Date | null;
  finishedAt: Date | null;
  lastActivityAt: Date | null;
}

export interface SpanRow {
  spanId: string;
  stage: string;
  iteration: number | null;
  parentSpanId: string | null;
  status: SpanStatus;
  score: number | null;
  artifactIds: string[];
  attrs: Record<string, unknown> | null;
  startedAt: Date;
  endedAt: Date | null;
}

export interface ExperimentsRepository {
  insert(input: {
    id: string;
    owner: string;
    driverAgentId: string;
    name: string;
    skeleton: Skeleton;
    scriptPath: string;
    scriptSha256: string;
    scriptArtifactId: string;
    scriptVersion: number;
    dashboardArtifactId: string | null;
    /** Runs are born `running` (never draft — the lineage draft persists and
     *  the one-draft-per-name index must stay free); omit for the draft. */
    status?: ExperimentStatus;
    executedAt?: Date;
    lastActivityAt?: Date;
  }): Promise<void>;
  get(id: string, owner: string): Promise<ExperimentRow | null>;
  list(owner: string): Promise<ExperimentRow[]>;
  getDraft(driverAgentId: string, name: string): Promise<ExperimentRow | null>;
  /** How many runs (non-draft rows) this lineage already has — the next
   *  run's number for cloned-artifact titles. With `before`, counts only
   *  runs created earlier (a run's own stable number at any later time). */
  countRuns(
    driverAgentId: string,
    name: string,
    before?: Date,
  ): Promise<number>;
  /** Point the run at its results artifact (created at the terminal
   *  snapshot; until then a run renders the draft's dashboard). */
  patchDashboardArtifact(id: string, artifactId: string): Promise<void>;
  /** Plan re-registration: refresh a draft's declaration in place. */
  updateDraft(
    id: string,
    patch: {
      skeleton: Skeleton;
      scriptPath: string;
      scriptSha256: string;
      scriptVersion: number;
      dashboardArtifactId: string | null;
    },
  ): Promise<void>;
  /** Atomic conditional lifecycle flip (`WHERE status = from`); false = lost
   *  the race to a concurrent transition, caller treats as already-terminal. */
  transition(
    id: string,
    from: ExperimentStatus,
    to: ExperimentStatus,
    patch?: {
      error?: string | null;
      executedAt?: Date;
      finishedAt?: Date;
      lastActivityAt?: Date;
    },
  ): Promise<boolean>;
  patchScript(
    id: string,
    patch: { scriptSha256: string; scriptVersion: number },
  ): Promise<void>;
  /** Full overwrite, not an atomic jsonb append: safe because one driver
   *  emits an experiment's events serially through one service call — two
   *  concurrent appendEvents for the same experiment don't happen. */
  appendDrift(id: string, drift: string[]): Promise<void>;
  /** Replace the run's attached-artifact list (caller unions + dedups). */
  setAttachedArtifacts(id: string, artifactIds: string[]): Promise<void>;
  patchCustomData(
    id: string,
    data: Record<string, unknown> | null,
  ): Promise<void>;
  bumpActivity(id: string, at: Date): Promise<void>;
  delete(id: string, owner: string): Promise<void>;

  /** Insert the running row for span-start; a duplicate start no-ops. */
  insertSpan(
    experimentId: string,
    span: {
      spanId: string;
      stage: string;
      iteration: number | null;
      parentSpanId: string | null;
      startedAt: Date;
    },
  ): Promise<void>;
  /** Close a span. An end with no prior start inserts the complete row, so
   *  out-of-order batches never drop data. */
  endSpan(
    experimentId: string,
    span: {
      spanId: string;
      status: Exclude<SpanStatus, "running">;
      score: number | null;
      artifactIds: string[];
      attrs: Record<string, unknown> | null;
      endedAt: Date;
    },
  ): Promise<void>;
  /** Chronological (startedAt ascending) — the order projectFeed requires. */
  listSpans(experimentId: string): Promise<SpanRow[]>;

  /** `running` rows silent past the window — the inactivity sweep reaps these.
   *  The activity basis is lastActivityAt, falling back to executedAt. */
  listInactiveRunning(cutoff: Date, limit: number): Promise<ExperimentRow[]>;
  /** Driver ids with at least one `running` experiment — pin reconciliation. */
  listRunningDrivers(): Promise<string[]>;
  /** Whether the driver still has any `running` experiment — the pin is
   *  released only when this goes false. */
  hasRunningForDriver(driverAgentId: string): Promise<boolean>;
}

function toRow(r: typeof experimentsTable.$inferSelect): ExperimentRow {
  return {
    id: r.id,
    owner: r.owner,
    driverAgentId: r.driverAgentId,
    name: r.name,
    status: r.status as ExperimentStatus,
    skeleton: r.skeleton as Skeleton,
    drift: (r.drift as string[]) ?? [],
    customData: r.customData as Record<string, unknown> | null,
    attachedArtifactIds: (r.attachedArtifactIds as string[]) ?? [],
    scriptPath: r.scriptPath,
    scriptSha256: r.scriptSha256,
    scriptArtifactId: r.scriptArtifactId,
    scriptVersion: r.scriptVersion,
    dashboardArtifactId: r.dashboardArtifactId,
    error: r.error,
    createdAt: r.createdAt,
    executedAt: r.executedAt,
    finishedAt: r.finishedAt,
    lastActivityAt: r.lastActivityAt,
  };
}

function toSpanRow(r: typeof spansTable.$inferSelect): SpanRow {
  return {
    spanId: r.spanId,
    stage: r.stage,
    iteration: r.iteration,
    parentSpanId: r.parentSpanId,
    status: r.status as SpanStatus,
    score: r.score,
    artifactIds: (r.artifactIds as string[]) ?? [],
    attrs: r.attrs as Record<string, unknown> | null,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
  };
}

/** The composite PK keeps SDK-chosen span ids unique per experiment only. */
export function spanRowId(experimentId: string, spanId: string): string {
  return `${experimentId}/${spanId}`;
}

export function createExperimentsRepository(db: Db): ExperimentsRepository {
  return {
    async insert(input) {
      await db.insert(experimentsTable).values({
        id: input.id,
        owner: input.owner,
        driverAgentId: input.driverAgentId,
        name: input.name,
        status: input.status ?? "draft",
        skeleton: input.skeleton,
        drift: [],
        scriptPath: input.scriptPath,
        scriptSha256: input.scriptSha256,
        scriptArtifactId: input.scriptArtifactId,
        scriptVersion: input.scriptVersion,
        dashboardArtifactId: input.dashboardArtifactId,
        ...(input.executedAt ? { executedAt: input.executedAt } : {}),
        ...(input.lastActivityAt
          ? { lastActivityAt: input.lastActivityAt }
          : {}),
      });
    },

    async get(id, owner) {
      const rows = await db
        .select()
        .from(experimentsTable)
        .where(
          and(eq(experimentsTable.id, id), eq(experimentsTable.owner, owner)),
        )
        .limit(1);
      return rows[0] ? toRow(rows[0]) : null;
    },

    async list(owner) {
      const rows = await db
        .select()
        .from(experimentsTable)
        .where(eq(experimentsTable.owner, owner))
        .orderBy(desc(experimentsTable.createdAt));
      return rows.map(toRow);
    },

    async getDraft(driverAgentId, name) {
      const rows = await db
        .select()
        .from(experimentsTable)
        .where(
          and(
            eq(experimentsTable.driverAgentId, driverAgentId),
            eq(experimentsTable.name, name),
            eq(experimentsTable.status, "draft"),
          ),
        )
        .limit(1);
      return rows[0] ? toRow(rows[0]) : null;
    },

    async countRuns(driverAgentId, name, before) {
      const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(experimentsTable)
        .where(
          and(
            eq(experimentsTable.driverAgentId, driverAgentId),
            eq(experimentsTable.name, name),
            sql`${experimentsTable.status} != 'draft'`,
            ...(before ? [lt(experimentsTable.createdAt, before)] : []),
          ),
        );
      return rows[0]?.count ?? 0;
    },

    async patchDashboardArtifact(id, artifactId) {
      await db
        .update(experimentsTable)
        .set({ dashboardArtifactId: artifactId })
        .where(eq(experimentsTable.id, id));
    },

    async updateDraft(id, patch) {
      await db
        .update(experimentsTable)
        .set({
          skeleton: patch.skeleton,
          drift: [],
          scriptPath: patch.scriptPath,
          scriptSha256: patch.scriptSha256,
          scriptVersion: patch.scriptVersion,
          dashboardArtifactId: patch.dashboardArtifactId,
        })
        .where(
          and(
            eq(experimentsTable.id, id),
            eq(experimentsTable.status, "draft"),
          ),
        );
    },

    async transition(id, from, to, patch = {}) {
      const updated = await db
        .update(experimentsTable)
        .set({ status: to, ...patch })
        .where(
          and(eq(experimentsTable.id, id), eq(experimentsTable.status, from)),
        )
        .returning({ id: experimentsTable.id });
      return updated.length > 0;
    },

    async patchScript(id, patch) {
      await db
        .update(experimentsTable)
        .set(patch)
        .where(eq(experimentsTable.id, id));
    },

    async appendDrift(id, drift) {
      await db
        .update(experimentsTable)
        .set({ drift })
        .where(eq(experimentsTable.id, id));
    },

    async setAttachedArtifacts(id, artifactIds) {
      await db
        .update(experimentsTable)
        .set({ attachedArtifactIds: artifactIds })
        .where(eq(experimentsTable.id, id));
    },

    async patchCustomData(id, data) {
      await db
        .update(experimentsTable)
        .set({ customData: data })
        .where(eq(experimentsTable.id, id));
    },

    async bumpActivity(id, at) {
      await db
        .update(experimentsTable)
        .set({ lastActivityAt: at })
        .where(eq(experimentsTable.id, id));
    },

    async delete(id, owner) {
      await db
        .delete(experimentsTable)
        .where(
          and(eq(experimentsTable.id, id), eq(experimentsTable.owner, owner)),
        );
    },

    async insertSpan(experimentId, span) {
      await db
        .insert(spansTable)
        .values({
          id: spanRowId(experimentId, span.spanId),
          experimentId,
          spanId: span.spanId,
          stage: span.stage,
          iteration: span.iteration,
          parentSpanId: span.parentSpanId,
          status: "running",
          startedAt: span.startedAt,
        })
        .onConflictDoNothing();
    },

    async endSpan(experimentId, span) {
      await db
        .insert(spansTable)
        .values({
          id: spanRowId(experimentId, span.spanId),
          experimentId,
          spanId: span.spanId,
          // An end with no start carries no stage; "unknown" keeps the row
          // visible in the drill-down instead of dropping the event.
          stage: "unknown",
          status: span.status,
          score: span.score,
          artifactIds: span.artifactIds,
          attrs: span.attrs,
          startedAt: span.endedAt,
          endedAt: span.endedAt,
        })
        .onConflictDoUpdate({
          target: spansTable.id,
          set: {
            status: span.status,
            score: span.score,
            artifactIds: span.artifactIds,
            attrs: span.attrs,
            endedAt: span.endedAt,
          },
        });
    },

    async listSpans(experimentId) {
      const rows = await db
        .select()
        .from(spansTable)
        .where(eq(spansTable.experimentId, experimentId))
        .orderBy(asc(spansTable.startedAt), asc(spansTable.id));
      return rows.map(toSpanRow);
    },

    async listInactiveRunning(cutoff, limit) {
      const rows = await db
        .select()
        .from(experimentsTable)
        .where(
          and(
            eq(experimentsTable.status, "running"),
            or(
              lt(experimentsTable.lastActivityAt, cutoff),
              and(
                isNull(experimentsTable.lastActivityAt),
                lt(experimentsTable.executedAt, cutoff),
              ),
            ),
          ),
        )
        .limit(limit);
      return rows.map(toRow);
    },

    async listRunningDrivers() {
      const rows = await db
        .selectDistinct({ driverAgentId: experimentsTable.driverAgentId })
        .from(experimentsTable)
        .where(eq(experimentsTable.status, "running"));
      return rows.map((r) => r.driverAgentId);
    },

    async hasRunningForDriver(driverAgentId) {
      const rows = await db
        .select({ id: experimentsTable.id })
        .from(experimentsTable)
        .where(
          and(
            eq(experimentsTable.driverAgentId, driverAgentId),
            eq(experimentsTable.status, "running"),
          ),
        )
        .limit(1);
      return rows.length > 0;
    },
  };
}
