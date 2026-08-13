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

export const DEFAULT_MAX_APPLY_ATTEMPTS = 8;

export interface ApplyTransitions {
  newlyFailed: DriverFailure[];
  recovered: string[];
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
  recordOutcome(
    agentId: string,
    settledVersion: number,
    result: {
      appliedVersion: number;
      appliedHash: string | null;
      failures: DriverFailure[];
      settledEventIds: string[];
    },
    maxAttempts?: number,
  ): Promise<ApplyTransitions>;
  listRetryable(maxAttempts: number, limit: number): Promise<OutboxRow[]>;
  seedingAgentIds(agentIds: string[]): Promise<Set<string>>;
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
          const nextAttempts = prev.applyAttempts + 1;
          await tx
            .update(runtimeStateOutbox)
            .set({
              lastSettledVersion: settledVersion,
              applyFailures: result.failures,
              applyAttempts: nextAttempts,
            })
            .where(eq(runtimeStateOutbox.agentId, agentId));
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

    async seedingAgentIds(agentIds): Promise<Set<string>> {
      if (agentIds.length === 0) return new Set();
      const rows = (await db
        .select({ agentId: runtimeEvents.agentId })
        .from(runtimeEvents)
        .where(
          and(
            inArray(runtimeEvents.agentId, agentIds),
            eq(runtimeEvents.kind, "workspace-seed"),
            isNull(runtimeEvents.dispatchedAt),
            sql`${runtimeEvents.expiresAt} > now()`,
          ),
        )) as { agentId: string }[];
      return new Set(rows.map((r) => r.agentId));
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
