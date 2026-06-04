import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  lt,
  or,
  sql,
  type Db,
  type DbTx,
  runtimeStateOutbox,
  runtimeEvents,
  agents as agentsTable,
} from "db";
import type { DriverFailure, RuntimeEventKind } from "api-server-api";

export interface OutboxRow {
  agentId: string;
  version: number;
  lastEnqueuedAt: Date;
  lastSettledVersion: number;
  lastAppliedVersion: number;
  lastAppliedHash: string | null;
  lastAppliedAt: Date | null;
  applyFailures: DriverFailure[];
  applyAttempts: number;
}

export interface PendingEventRow {
  id: string;
  agentId: string;
  kind: RuntimeEventKind;
  payload: unknown;
  version: number;
  expiresAt: Date;
}

/** Default cap on background re-dispatch of a failing settle. */
export const DEFAULT_MAX_APPLY_ATTEMPTS = 8;

/** Failure transitions for a settle, diffed under the row lock so each fires once. */
export interface ApplyTransitions {
  /** Started failing this settle → ContributionApplyFailed. */
  newlyFailed: DriverFailure[];
  /** Were failing, now succeeded → ContributionRecovered. */
  recovered: string[];
  /** Hit the retry cap this settle → ContributionApplyGaveUp. */
  gaveUp: DriverFailure[];
}

export interface OutboxRepo {
  getRow(agentId: string): Promise<OutboxRow | null>;
  getRows(agentIds: string[]): Promise<OutboxRow[]>;
  bumpVersion(
    agentId: string,
    tx?: Db | DbTx,
    resetContributionErrors?: boolean,
  ): Promise<number>;
  pendingEvents(agentId: string): Promise<PendingEventRow[]>;
  /** Record a settled apply and return the failure transitions (diffed under a row lock). */
  recordOutcome(
    agentId: string,
    settledVersion: number,
    result: {
      appliedVersion: number;
      appliedHash: string | null;
      failures: DriverFailure[];
      /** Event ids the agent settled this apply; marked dispatched regardless of failures. */
      settledEventIds: string[];
    },
    maxAttempts?: number,
  ): Promise<ApplyTransitions>;
  /** Rows the sweep should re-dispatch: unsettled, or settled-with-failures under the attempt cap. */
  listRetryable(maxAttempts: number, limit: number): Promise<OutboxRow[]>;
  deleteExpiredEvents(): Promise<number>;
  insertEvent(
    input: PendingEventRow & { createdAt?: Date },
    tx?: Db | DbTx,
  ): Promise<void>;
}

interface InternalRow {
  agentId: string;
  version: number;
  lastEnqueuedAt: Date;
  lastSettledVersion: number;
  lastAppliedVersion: number;
  lastAppliedHash: string | null;
  lastAppliedAt: Date | null;
  applyFailures: DriverFailure[];
  applyAttempts: number;
}

export function createOutboxRepo(db: Db): OutboxRepo {
  return {
    async getRow(agentId): Promise<OutboxRow | null> {
      const rows = (await db
        .select()
        .from(runtimeStateOutbox)
        .where(eq(runtimeStateOutbox.agentId, agentId))) as InternalRow[];
      return rows[0] ?? null;
    },

    async getRows(agentIds): Promise<OutboxRow[]> {
      if (agentIds.length === 0) return [];
      const rows = (await db
        .select()
        .from(runtimeStateOutbox)
        .where(inArray(runtimeStateOutbox.agentId, agentIds))) as InternalRow[];
      return rows;
    },

    async bumpVersion(
      agentId,
      tx = db,
      resetContributionErrors = true,
    ): Promise<number> {
      // Only a contribution change re-arms retry; an event bump leaves errors intact.
      const clearErrors = resetContributionErrors
        ? sql`, apply_attempts = 0, apply_failures = '[]'::jsonb`
        : sql``;
      const result = (await tx.execute(
        sql`
          INSERT INTO runtime_state_outbox (agent_id, version, last_enqueued_at)
          VALUES (${agentId}, 1, now())
          ON CONFLICT (agent_id) DO UPDATE
            SET version = runtime_state_outbox.version + 1,
                last_enqueued_at = now()${clearErrors}
          RETURNING version
        `,
      )) as unknown as { version: number }[];
      return result[0]!.version;
    },

    async pendingEvents(agentId): Promise<PendingEventRow[]> {
      const rows = (await db
        .select()
        .from(runtimeEvents)
        .where(
          and(
            eq(runtimeEvents.agentId, agentId),
            isNull(runtimeEvents.dispatchedAt),
            sql`${runtimeEvents.expiresAt} > now()`,
          ),
        )
        .orderBy(runtimeEvents.version)) as {
        id: string;
        agentId: string;
        kind: string;
        payload: unknown;
        version: number;
        expiresAt: Date;
      }[];
      return rows.map((r) => ({
        id: r.id,
        agentId: r.agentId,
        kind: r.kind as RuntimeEventKind,
        payload: r.payload,
        version: r.version,
        expiresAt: r.expiresAt,
      }));
    },

    async recordOutcome(
      agentId,
      settledVersion,
      result,
      maxAttempts = DEFAULT_MAX_APPLY_ATTEMPTS,
    ): Promise<ApplyTransitions> {
      const clean = result.failures.length === 0 && result.appliedHash !== null;
      return db.transaction(async (tx) => {
        // Lock the row so concurrent workers can't both emit the same transition.
        const locked = (await tx
          .select()
          .from(runtimeStateOutbox)
          .where(eq(runtimeStateOutbox.agentId, agentId))
          .for("update")) as InternalRow[];
        const prev = locked[0];
        if (!prev) return { newlyFailed: [], recovered: [], gaveUp: [] };

        const prevKinds = new Set(prev.applyFailures.map((f) => f.kind));
        const currKinds = new Set(result.failures.map((f) => f.kind));
        const newlyFailed = result.failures.filter(
          (f) => !prevKinds.has(f.kind),
        );
        const recovered = [...prevKinds].filter((k) => !currKinds.has(k));

        // Events settle per-id, independent of the contribution outcome.
        if (result.settledEventIds.length > 0) {
          await tx
            .update(runtimeEvents)
            .set({ dispatchedAt: new Date() })
            .where(
              and(
                eq(runtimeEvents.agentId, agentId),
                inArray(runtimeEvents.id, result.settledEventIds),
                isNull(runtimeEvents.dispatchedAt),
              ),
            );
        }

        if (!clean) {
          // Leave the applied cursor behind so the retry re-dispatches.
          const nextAttempts = prev.applyAttempts + 1;
          await tx
            .update(runtimeStateOutbox)
            .set({
              lastSettledVersion: settledVersion,
              applyFailures: result.failures,
              applyAttempts: nextAttempts,
            })
            .where(eq(runtimeStateOutbox.agentId, agentId));
          // Only on the crossing into the cap, else a re-run (hello, direct enqueue) re-emits.
          const gaveUp =
            prev.applyAttempts < maxAttempts && nextAttempts >= maxAttempts
              ? result.failures
              : [];
          return { newlyFailed, recovered, gaveUp };
        }

        await tx
          .update(runtimeStateOutbox)
          .set({
            lastSettledVersion: settledVersion,
            lastAppliedVersion: result.appliedVersion,
            lastAppliedHash: result.appliedHash,
            lastAppliedAt: new Date(),
            applyFailures: [],
            applyAttempts: 0,
          })
          .where(eq(runtimeStateOutbox.agentId, agentId));
        return { newlyFailed, recovered, gaveUp: [] };
      });
    },

    async listRetryable(maxAttempts, limit): Promise<OutboxRow[]> {
      const rows = (await db
        .select()
        .from(runtimeStateOutbox)
        .where(
          or(
            sql`${runtimeStateOutbox.lastSettledVersion} < ${runtimeStateOutbox.version}`,
            and(
              sql`${runtimeStateOutbox.applyFailures} <> '[]'::jsonb`,
              lt(runtimeStateOutbox.applyAttempts, maxAttempts),
            ),
          ),
        )
        .orderBy(asc(runtimeStateOutbox.applyAttempts))
        .limit(limit)) as InternalRow[];
      return rows;
    },

    async deleteExpiredEvents(): Promise<number> {
      const result = (await db
        .delete(runtimeEvents)
        .where(
          and(
            isNull(runtimeEvents.dispatchedAt),
            lt(runtimeEvents.expiresAt, sql`now()` as unknown as Date),
          ),
        )
        .returning({ id: runtimeEvents.id })) as { id: string }[];
      return result.length;
    },

    async insertEvent(input, tx = db): Promise<void> {
      await tx.insert(runtimeEvents).values({
        id: input.id,
        agentId: input.agentId,
        kind: input.kind,
        payload: input.payload as object,
        version: input.version,
        expiresAt: input.expiresAt,
      });
    },
  };
}

export interface AgentRuntimeStateRow {
  id: string;
  runtimeProtocolVersion: string | null;
  runtimeCapabilities: unknown;
  runtimeLastHelloAt: Date | null;
  runtimeAgentVersion: string | null;
}

export interface AgentsRuntimeRepo {
  upsertHello(input: {
    agentId: string;
    protocolVersion: string;
    capabilities: unknown;
    agentRuntimeVersion: string;
  }): Promise<void>;
  get(agentId: string): Promise<AgentRuntimeStateRow | null>;
}

export function createAgentsRuntimeRepo(db: Db): AgentsRuntimeRepo {
  return {
    async upsertHello(input): Promise<void> {
      await db
        .update(agentsTable)
        .set({
          runtimeProtocolVersion: input.protocolVersion,
          runtimeCapabilities: input.capabilities as object,
          runtimeLastHelloAt: new Date(),
          runtimeAgentVersion: input.agentRuntimeVersion,
        })
        .where(eq(agentsTable.id, input.agentId));
    },

    async get(agentId): Promise<AgentRuntimeStateRow | null> {
      const rows = (await db
        .select()
        .from(agentsTable)
        .where(eq(agentsTable.id, agentId))) as AgentRuntimeStateRow[];
      return rows[0] ?? null;
    },
  };
}
