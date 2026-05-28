import {
  and,
  eq,
  gt,
  isNull,
  lt,
  lte,
  or,
  sql,
  type Db,
  runtimeStateOutbox,
  runtimeEvents,
  agents as agentsTable,
} from "db";
import type { RuntimeEventKind } from "api-server-api";

export interface OutboxRow {
  agentId: string;
  version: number;
  lastEnqueuedAt: Date;
  lastAppliedVersion: number;
  lastAppliedHash: string | null;
  lastAppliedAt: Date | null;
}

export interface PendingEventRow {
  id: string;
  agentId: string;
  kind: RuntimeEventKind;
  payload: unknown;
  version: number;
  expiresAt: Date;
}

export interface OutboxRepo {
  getRow(agentId: string): Promise<OutboxRow | null>;
  bumpVersion(agentId: string, db?: Db): Promise<number>;
  pendingEvents(agentId: string): Promise<PendingEventRow[]>;
  stampAck(
    agentId: string,
    ackedVersion: number,
    ackedHash: string,
  ): Promise<void>;
  listStale(slopMs: number, limit: number): Promise<OutboxRow[]>;
  deleteExpiredEvents(): Promise<number>;
  insertEvent(input: PendingEventRow & { createdAt?: Date }): Promise<void>;
}

interface InternalRow {
  agentId: string;
  version: number;
  lastEnqueuedAt: Date;
  lastAppliedVersion: number;
  lastAppliedHash: string | null;
  lastAppliedAt: Date | null;
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

    async bumpVersion(agentId, tx = db): Promise<number> {
      const result = (await tx.execute(
        sql`
          INSERT INTO runtime_state_outbox (agent_id, version, last_enqueued_at)
          VALUES (${agentId}, 1, now())
          ON CONFLICT (agent_id) DO UPDATE
            SET version = runtime_state_outbox.version + 1,
                last_enqueued_at = now()
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

    async stampAck(agentId, ackedVersion, ackedHash): Promise<void> {
      await db.transaction(async (tx) => {
        await tx
          .update(runtimeStateOutbox)
          .set({
            lastAppliedVersion: ackedVersion,
            lastAppliedHash: ackedHash,
            lastAppliedAt: new Date(),
          })
          .where(eq(runtimeStateOutbox.agentId, agentId));
        await tx
          .update(runtimeEvents)
          .set({ dispatchedAt: new Date() })
          .where(
            and(
              eq(runtimeEvents.agentId, agentId),
              lte(runtimeEvents.version, ackedVersion),
              isNull(runtimeEvents.dispatchedAt),
            ),
          );
      });
    },

    async listStale(slopMs, limit): Promise<OutboxRow[]> {
      const cutoff = new Date(Date.now() - slopMs);
      const rows = (await db
        .select()
        .from(runtimeStateOutbox)
        .where(
          and(
            or(
              isNull(runtimeStateOutbox.lastAppliedAt),
              gt(
                runtimeStateOutbox.lastEnqueuedAt,
                runtimeStateOutbox.lastAppliedAt,
              ),
            ),
            lt(runtimeStateOutbox.lastEnqueuedAt, cutoff),
          ),
        )
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

    async insertEvent(input): Promise<void> {
      await db.insert(runtimeEvents).values({
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
