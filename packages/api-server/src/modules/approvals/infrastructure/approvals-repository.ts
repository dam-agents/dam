import { and, asc, desc, eq, isNull, lt, sql, type Db } from "db";
import { pendingApprovals } from "db";
import type {
  ApprovalPayload,
  ApprovalStatus,
  ApprovalType,
} from "api-server-api";
import type { PendingApprovalRow } from "../domain/types.js";

export interface ListApprovalsRepoOpts {
  limit?: number;
  status?: ApprovalStatus;
}

export interface ApprovalsRepository {
  insertPending(row: NewPendingApproval): Promise<void>;
  getPending(id: string): Promise<PendingApprovalRow | null>;
  findActivePendingExtAuthz(input: {
    agentId: string;
    host: string;
    method: string;
    path: string;
  }): Promise<PendingApprovalRow | null>;
  findPendingAcpNativeByRpcId(
    agentId: string,
    rpcId: number | string,
  ): Promise<PendingApprovalRow[]>;
  listPendingForOwner(
    ownerSub: string,
    opts?: ListApprovalsRepoOpts,
  ): Promise<PendingApprovalRow[]>;
  listPendingForInstance(
    agentId: string,
    opts?: ListApprovalsRepoOpts,
  ): Promise<PendingApprovalRow[]>;
  resolvePending(
    id: string,
    verdict: "allow_once" | "allow" | "deny_once" | "deny",
    decidedBy: string,
    opts?: { markDelivered?: boolean },
  ): Promise<boolean>;
  resolveExpired(
    id: string,
    verdict: "allow" | "deny",
    decidedBy: string,
  ): Promise<boolean>;
  markDelivered(id: string): Promise<void>;
  listResolvedUndelivered(opts: {
    staleMs: number;
    limit: number;
  }): Promise<PendingApprovalRow[]>;
  expirePending(id: string): Promise<void>;
  expireOverdue(
    now: Date,
  ): Promise<Array<{ id: string; agentId: string; ownerSub: string }>>;
  deleteForAgent(agentId: string): Promise<void>;
  listDistinctAgentIds(): Promise<string[]>;
}

export interface NewPendingApproval {
  id: string;
  type: ApprovalType;
  agentId: string;
  ownerSub: string;
  sessionId: string | null;
  payload: ApprovalPayload;
  expiresAt: Date;
}

interface RawPending {
  id: string;
  type: string;
  agentId: string;
  ownerSub: string;
  sessionId: string | null;
  payload: unknown;
  createdAt: Date | string;
  expiresAt: Date | string;
  resolvedAt: Date | string | null;
  verdict: string | null;
  decidedBy: string | null;
  status: string;
  deliveredAt: Date | string | null;
}

const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 500;

function clampLimit(requested: number | undefined): number {
  if (requested === undefined) return DEFAULT_LIST_LIMIT;
  if (requested < 1) return DEFAULT_LIST_LIMIT;
  return Math.min(requested, MAX_LIST_LIMIT);
}

const toDate = (v: Date | string): Date =>
  v instanceof Date ? v : new Date(v);

function toPendingRow(r: RawPending): PendingApprovalRow {
  return {
    id: r.id,
    type: r.type as ApprovalType,
    agentId: r.agentId,
    ownerSub: r.ownerSub,
    sessionId: r.sessionId,
    payload: r.payload as ApprovalPayload,
    createdAt: toDate(r.createdAt),
    expiresAt: toDate(r.expiresAt),
    resolvedAt: r.resolvedAt === null ? null : toDate(r.resolvedAt),
    verdict: r.verdict as PendingApprovalRow["verdict"],
    decidedBy: r.decidedBy,
    status: r.status as ApprovalStatus,
    deliveredAt: r.deliveredAt === null ? null : toDate(r.deliveredAt),
  };
}

export function createApprovalsRepository(db: Db): ApprovalsRepository {
  return {
    async insertPending(row) {
      await db
        .insert(pendingApprovals)
        .values({
          id: row.id,
          type: row.type,
          agentId: row.agentId,
          ownerSub: row.ownerSub,
          sessionId: row.sessionId,
          payload: row.payload,
          expiresAt: row.expiresAt,
        })
        .onConflictDoUpdate({
          target: pendingApprovals.id,
          set: {
            type: row.type,
            agentId: row.agentId,
            ownerSub: row.ownerSub,
            sessionId: row.sessionId,
            payload: row.payload,
            expiresAt: row.expiresAt,
            createdAt: new Date(),
            status: "pending",
            resolvedAt: null,
            verdict: null,
            decidedBy: null,
            deliveredAt: null,
          },
          setWhere: sql`${pendingApprovals.status} <> 'pending'`,
        });
    },

    async getPending(id) {
      const rows = await db
        .select()
        .from(pendingApprovals)
        .where(eq(pendingApprovals.id, id));
      return rows.length ? toPendingRow(rows[0] as RawPending) : null;
    },

    async findActivePendingExtAuthz({ agentId, host, method, path }) {
      const rows = await db.execute(sql`
        SELECT id, type, agent_id AS "agentId",
               owner_sub AS "ownerSub", session_id AS "sessionId", payload,
               created_at AS "createdAt", expires_at AS "expiresAt",
               resolved_at AS "resolvedAt", verdict, decided_by AS "decidedBy",
               status, delivered_at AS "deliveredAt"
        FROM ${pendingApprovals}
        WHERE agent_id = ${agentId}
          AND status = 'pending'
          AND type = 'ext_authz'
          AND payload->>'host' = ${host}
          AND payload->>'method' = ${method}
          AND payload->>'path' = ${path}
        ORDER BY created_at DESC
        LIMIT 1
      `);
      const list = rows as unknown as RawPending[];
      return list.length ? toPendingRow(list[0]) : null;
    },

    async findPendingAcpNativeByRpcId(agentId, rpcId) {
      const rows = await db.execute(sql`
        SELECT id, type, agent_id AS "agentId",
               owner_sub AS "ownerSub", session_id AS "sessionId", payload,
               created_at AS "createdAt", expires_at AS "expiresAt",
               resolved_at AS "resolvedAt", verdict, decided_by AS "decidedBy",
               status, delivered_at AS "deliveredAt"
        FROM ${pendingApprovals}
        WHERE agent_id = ${agentId}
          AND status = 'pending'
          AND type = 'acp_native'
          AND payload->>'rpcId' = ${String(rpcId)}
        ORDER BY created_at DESC
        LIMIT 2
      `);
      return (rows as unknown as RawPending[]).map(toPendingRow);
    },

    async listPendingForOwner(ownerSub, opts) {
      const limit = clampLimit(opts?.limit);
      const where = opts?.status
        ? and(
            eq(pendingApprovals.ownerSub, ownerSub),
            eq(pendingApprovals.status, opts.status),
          )
        : eq(pendingApprovals.ownerSub, ownerSub);
      const rows = await db
        .select()
        .from(pendingApprovals)
        .where(where)
        .orderBy(desc(pendingApprovals.createdAt))
        .limit(limit);
      return rows.map((r) => toPendingRow(r as RawPending));
    },

    async listPendingForInstance(agentId, opts) {
      const limit = clampLimit(opts?.limit);
      const where = opts?.status
        ? and(
            eq(pendingApprovals.agentId, agentId),
            eq(pendingApprovals.status, opts.status),
          )
        : eq(pendingApprovals.agentId, agentId);
      const rows = await db
        .select()
        .from(pendingApprovals)
        .where(where)
        .orderBy(desc(pendingApprovals.createdAt))
        .limit(limit);
      return rows.map((r) => toPendingRow(r as RawPending));
    },

    async resolvePending(id, verdict, decidedBy, opts) {
      const now = new Date();
      const rows = await db
        .update(pendingApprovals)
        .set({
          status: "resolved",
          verdict,
          decidedBy,
          resolvedAt: now,
          ...(opts?.markDelivered ? { deliveredAt: now } : {}),
        })
        .where(
          and(
            eq(pendingApprovals.id, id),
            eq(pendingApprovals.status, "pending"),
          ),
        )
        .returning({ id: pendingApprovals.id });
      return rows.length > 0;
    },

    async resolveExpired(id, verdict, decidedBy) {
      const now = new Date();
      const rows = await db
        .update(pendingApprovals)
        .set({
          status: "resolved",
          verdict,
          decidedBy,
          resolvedAt: now,
          deliveredAt: now,
        })
        .where(
          and(
            eq(pendingApprovals.id, id),
            eq(pendingApprovals.status, "expired"),
          ),
        )
        .returning({ id: pendingApprovals.id });
      return rows.length > 0;
    },

    async markDelivered(id) {
      await db
        .update(pendingApprovals)
        .set({ deliveredAt: new Date() })
        .where(
          and(
            eq(pendingApprovals.id, id),
            eq(pendingApprovals.status, "resolved"),
            isNull(pendingApprovals.deliveredAt),
          ),
        );
    },

    async listResolvedUndelivered({ staleMs, limit }) {
      const cutoff = new Date(Date.now() - staleMs);
      const rows = await db
        .select()
        .from(pendingApprovals)
        .where(
          and(
            eq(pendingApprovals.status, "resolved"),
            isNull(pendingApprovals.deliveredAt),
            lt(pendingApprovals.resolvedAt, cutoff),
          ),
        )
        .orderBy(asc(pendingApprovals.resolvedAt))
        .limit(limit);
      return rows.map((r) => toPendingRow(r as RawPending));
    },

    async expirePending(id) {
      await db
        .update(pendingApprovals)
        .set({ status: "expired", resolvedAt: new Date() })
        .where(
          and(
            eq(pendingApprovals.id, id),
            eq(pendingApprovals.status, "pending"),
          ),
        );
    },

    async expireOverdue(now) {
      const rows = await db
        .update(pendingApprovals)
        .set({ status: "expired", resolvedAt: now })
        .where(
          and(
            eq(pendingApprovals.status, "pending"),
            lt(pendingApprovals.expiresAt, now),
          ),
        )
        .returning({
          id: pendingApprovals.id,
          agentId: pendingApprovals.agentId,
          ownerSub: pendingApprovals.ownerSub,
        });
      return rows;
    },

    async deleteForAgent(agentId) {
      await db
        .delete(pendingApprovals)
        .where(eq(pendingApprovals.agentId, agentId));
    },

    async listDistinctAgentIds() {
      const rows = await db.execute<{ agent_id: string }>(sql`
        SELECT DISTINCT agent_id FROM ${pendingApprovals}
      `);
      return (rows as unknown as Array<{ agent_id: string }>).map(
        (r) => r.agent_id,
      );
    },
  };
}
