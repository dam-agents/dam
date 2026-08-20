import {
  and,
  asc,
  eq,
  gt,
  lt,
  sql,
  type Db,
  hostedSessions,
  hostedTurns,
  hostedTurnEvents,
} from "db";
import { isUniqueViolation } from "../../../core/db-errors.js";
import type { TurnEvent, TurnEventKind } from "../domain/events.js";

export interface HostedSessionRow {
  id: string;
  agentId: string;
  owner: string;
  title: string | null;
  mode: string;
  scheduleId: string | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type TurnStatus = "running" | "done" | "interrupted" | "error";

export interface HostedTurnRow {
  id: string;
  sessionId: string;
  agentId: string;
  status: TurnStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface TurnLogRepository {
  createSession(input: {
    id: string;
    agentId: string;
    owner: string;
    title?: string;
    scheduleId?: string;
  }): Promise<void>;
  getSession(id: string): Promise<HostedSessionRow | null>;
  listSessions(agentId: string): Promise<HostedSessionRow[]>;
  setSessionMode(id: string, mode: string): Promise<void>;
  setSessionTitle(id: string, title: string): Promise<void>;
  recordSeen(id: string, at: Date): Promise<void>;
  deleteSession(id: string): Promise<void>;

  createTurn(input: {
    id: string;
    sessionId: string;
    agentId: string;
  }): Promise<void>;
  getTurn(id: string): Promise<HostedTurnRow | null>;
  heartbeatTurn(id: string): Promise<void>;
  endTurn(id: string, status: Exclude<TurnStatus, "running">): Promise<void>;
  listRunningTurnsStalledSince(cutoff: Date): Promise<HostedTurnRow[]>;
  runningTurnForSession(sessionId: string): Promise<HostedTurnRow | null>;

  appendEvent(input: {
    sessionId: string;
    turnId: string;
    seq: number;
    kind: TurnEventKind;
    payload: unknown;
  }): Promise<"ok" | "conflict">;
  listSessionEvents(
    sessionId: string,
    opts?: { afterId?: number; limit?: number },
  ): Promise<TurnEvent[]>;
  listTurnEvents(turnId: string): Promise<TurnEvent[]>;
}

const EVENTS_PAGE_MAX = 2_000;

export function createTurnLogRepository(db: Db): TurnLogRepository {
  const toEvent = (row: typeof hostedTurnEvents.$inferSelect): TurnEvent => ({
    id: row.id,
    sessionId: row.sessionId,
    turnId: row.turnId,
    seq: row.seq,
    kind: row.kind as TurnEventKind,
    payload: row.payload,
    createdAt: row.createdAt,
  });

  return {
    async createSession(input) {
      await db.insert(hostedSessions).values({
        id: input.id,
        agentId: input.agentId,
        owner: input.owner,
        title: input.title,
        scheduleId: input.scheduleId,
      });
    },

    async getSession(id) {
      const rows = await db
        .select()
        .from(hostedSessions)
        .where(eq(hostedSessions.id, id))
        .limit(1);
      return (rows[0] as HostedSessionRow | undefined) ?? null;
    },

    async listSessions(agentId) {
      return (await db
        .select()
        .from(hostedSessions)
        .where(eq(hostedSessions.agentId, agentId))
        .orderBy(asc(hostedSessions.createdAt))) as HostedSessionRow[];
    },

    async setSessionMode(id, mode) {
      await db
        .update(hostedSessions)
        .set({ mode, updatedAt: sql`now()` })
        .where(eq(hostedSessions.id, id));
    },

    async setSessionTitle(id, title) {
      await db
        .update(hostedSessions)
        .set({ title, updatedAt: sql`now()` })
        .where(eq(hostedSessions.id, id));
    },

    async recordSeen(id, at) {
      await db
        .update(hostedSessions)
        .set({ lastSeenAt: at })
        .where(eq(hostedSessions.id, id));
    },

    async deleteSession(id) {
      await db
        .delete(hostedTurnEvents)
        .where(eq(hostedTurnEvents.sessionId, id));
      await db.delete(hostedTurns).where(eq(hostedTurns.sessionId, id));
      await db.delete(hostedSessions).where(eq(hostedSessions.id, id));
    },

    async createTurn(input) {
      await db.insert(hostedTurns).values(input);
      await db
        .update(hostedSessions)
        .set({ updatedAt: sql`now()` })
        .where(eq(hostedSessions.id, input.sessionId));
    },

    async getTurn(id) {
      const rows = await db
        .select()
        .from(hostedTurns)
        .where(eq(hostedTurns.id, id))
        .limit(1);
      return (rows[0] as HostedTurnRow | undefined) ?? null;
    },

    async heartbeatTurn(id) {
      await db
        .update(hostedTurns)
        .set({ updatedAt: sql`now()` })
        .where(eq(hostedTurns.id, id));
    },

    async endTurn(id, status) {
      await db
        .update(hostedTurns)
        .set({ status, updatedAt: sql`now()` })
        .where(eq(hostedTurns.id, id));
    },

    async listRunningTurnsStalledSince(cutoff) {
      return (await db
        .select()
        .from(hostedTurns)
        .where(
          and(
            eq(hostedTurns.status, "running"),
            lt(hostedTurns.updatedAt, cutoff),
          ),
        )) as HostedTurnRow[];
    },

    async runningTurnForSession(sessionId) {
      const rows = await db
        .select()
        .from(hostedTurns)
        .where(
          and(
            eq(hostedTurns.sessionId, sessionId),
            eq(hostedTurns.status, "running"),
          ),
        )
        .limit(1);
      return (rows[0] as HostedTurnRow | undefined) ?? null;
    },

    async appendEvent(input) {
      try {
        await db.insert(hostedTurnEvents).values({
          sessionId: input.sessionId,
          turnId: input.turnId,
          seq: input.seq,
          kind: input.kind,
          payload: input.payload,
        });
        return "ok";
      } catch (err) {
        if (isUniqueViolation(err)) return "conflict";
        throw err;
      }
    },

    async listSessionEvents(sessionId, opts) {
      const limit = Math.min(opts?.limit ?? EVENTS_PAGE_MAX, EVENTS_PAGE_MAX);
      const where =
        opts?.afterId != null
          ? and(
              eq(hostedTurnEvents.sessionId, sessionId),
              gt(hostedTurnEvents.id, opts.afterId),
            )
          : eq(hostedTurnEvents.sessionId, sessionId);
      const rows = await db
        .select()
        .from(hostedTurnEvents)
        .where(where)
        .orderBy(asc(hostedTurnEvents.id))
        .limit(limit);
      return rows.map(toEvent);
    },

    async listTurnEvents(turnId) {
      const rows = await db
        .select()
        .from(hostedTurnEvents)
        .where(eq(hostedTurnEvents.turnId, turnId))
        .orderBy(asc(hostedTurnEvents.seq));
      return rows.map(toEvent);
    },
  };
}
