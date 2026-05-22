import { and, asc, eq, sql, type Db } from "db";
import { runtimeSignalOutbox } from "db";
import type { SignalEvent } from "api-server-api";

export interface SignalOutboxRow {
  id: string;
  agentId: string;
  action: string;
  payload: Record<string, unknown>;
  enqueuedAt: Date;
  expiresAt: Date;
}

export interface SignalOutboxRepository {
  /** Insert a new signal. Idempotent on `id` so a retried mutation
   *  cannot double-enqueue a logical action. */
  insert(input: {
    id: string;
    agentId: string;
    action: string;
    payload: Record<string, unknown>;
    expiresAt: Date;
  }): Promise<void>;
  get(id: string): Promise<SignalOutboxRow | null>;
  /** Pending signals for the agent, ordered by enqueue time (oldest
   *  first). Excludes anything past `expiresAt` — the cron sweep
   *  deletes expired rows; readers should not see them in the
   *  meantime. */
  listForAgent(agentId: string, now: Date): Promise<SignalOutboxRow[]>;
  deleteById(id: string): Promise<void>;
  /** Hard-delete every signal for an agent — called from the per-agent
   *  cleanup hook on K8s delete. */
  deleteForAgent(agentId: string): Promise<void>;
  /** Delete every row whose ttl has elapsed. Returns the deleted ids
   *  so callers can emit a `dropped-expired` metric. */
  deleteExpired(now: Date, limit: number): Promise<string[]>;
  /** Pending non-expired signals across all agents, oldest first.
   *  Used by the cron sweep to re-enqueue rows lost from Redis. */
  listPending(opts: { now: Date; limit: number }): Promise<SignalOutboxRow[]>;
}

export function createSignalOutboxRepository(db: Db): SignalOutboxRepository {
  return {
    async insert({ id, agentId, action, payload, expiresAt }) {
      await db
        .insert(runtimeSignalOutbox)
        .values({ id, agentId, action, payload, expiresAt })
        .onConflictDoNothing({ target: runtimeSignalOutbox.id });
    },

    async get(id) {
      const rows = await db
        .select()
        .from(runtimeSignalOutbox)
        .where(eq(runtimeSignalOutbox.id, id))
        .limit(1);
      return rows[0]
        ? {
            id: rows[0].id,
            agentId: rows[0].agentId,
            action: rows[0].action,
            payload: rows[0].payload as Record<string, unknown>,
            enqueuedAt: rows[0].enqueuedAt,
            expiresAt: rows[0].expiresAt,
          }
        : null;
    },

    async listForAgent(agentId, now) {
      const rows = await db
        .select()
        .from(runtimeSignalOutbox)
        .where(
          and(
            eq(runtimeSignalOutbox.agentId, agentId),
            sql`${runtimeSignalOutbox.expiresAt} > ${now}`,
          ),
        )
        .orderBy(asc(runtimeSignalOutbox.enqueuedAt));
      return rows.map((r) => ({
        id: r.id,
        agentId: r.agentId,
        action: r.action,
        payload: r.payload as Record<string, unknown>,
        enqueuedAt: r.enqueuedAt,
        expiresAt: r.expiresAt,
      }));
    },

    async deleteById(id) {
      await db
        .delete(runtimeSignalOutbox)
        .where(eq(runtimeSignalOutbox.id, id));
    },

    async deleteForAgent(agentId) {
      await db
        .delete(runtimeSignalOutbox)
        .where(eq(runtimeSignalOutbox.agentId, agentId));
    },

    async deleteExpired(now, limit) {
      const rows = await db
        .delete(runtimeSignalOutbox)
        .where(
          sql`${runtimeSignalOutbox.id} IN (
            SELECT ${runtimeSignalOutbox.id} FROM ${runtimeSignalOutbox}
            WHERE ${runtimeSignalOutbox.expiresAt} <= ${now}
            LIMIT ${limit}
          )`,
        )
        .returning({ id: runtimeSignalOutbox.id });
      return rows.map((r) => r.id);
    },

    async listPending({ now, limit }) {
      const rows = await db
        .select()
        .from(runtimeSignalOutbox)
        .where(sql`${runtimeSignalOutbox.expiresAt} > ${now}`)
        .orderBy(asc(runtimeSignalOutbox.enqueuedAt))
        .limit(limit);
      return rows.map((r) => ({
        id: r.id,
        agentId: r.agentId,
        action: r.action,
        payload: r.payload as Record<string, unknown>,
        enqueuedAt: r.enqueuedAt,
        expiresAt: r.expiresAt,
      }));
    },
  };
}

export type { SignalEvent };
