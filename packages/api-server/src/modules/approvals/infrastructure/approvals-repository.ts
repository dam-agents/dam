import { and, asc, desc, eq, isNull, lt, sql, type Db } from "db";
import { pendingApprovals } from "db";
import type { ApprovalPayload, ApprovalStatus, ApprovalType } from "api-server-api";
import type { PendingApprovalRow } from "../domain/types.js";

export interface ListApprovalsRepoOpts {
  /** Hard cap; the repository clamps to a safe upper bound on top of this. */
  limit?: number;
  status?: ApprovalStatus;
}

export interface ApprovalsRepository {
  insertPending(row: NewPendingApproval): Promise<void>;
  getPending(id: string): Promise<PendingApprovalRow | null>;
  listPendingForOwner(ownerSub: string, opts?: ListApprovalsRepoOpts): Promise<PendingApprovalRow[]>;
  listPendingForInstance(instanceId: string, opts?: ListApprovalsRepoOpts): Promise<PendingApprovalRow[]>;
  /** CAS update: only succeeds if the row is still `pending`. The single
   *  consumer of the pending → resolved transition is enforced here, so
   *  concurrent inbox clicks / in-session responses are at-most-once. */
  resolvePending(
    id: string,
    verdict: "allow_once" | "allow" | "deny_once" | "deny",
    decidedBy: string,
    opts?: { markDelivered?: boolean },
  ): Promise<void>;
  /** Idempotent. Stamps `delivered_at` on a row whose response frame has
   *  reached the wrapper. Re-running is harmless: the WHERE keeps it from
   *  overwriting an earlier delivery timestamp. */
  markDelivered(id: string): Promise<void>;
  /** Outbox sweep query — rows that were resolved at least `staleMs`
   *  milliseconds ago and never received a delivery stamp. Best-effort
   *  fallback for the rare case where the inline delivery path on the
   *  click-handling replica died before stamping `delivered_at`. */
  listResolvedUndelivered(opts: {
    staleMs: number;
    limit: number;
  }): Promise<PendingApprovalRow[]>;
  expirePending(id: string): Promise<void>;
  expireOverdue(now: Date): Promise<string[]>;
}

export interface NewPendingApproval {
  id: string;
  type: ApprovalType;
  instanceId: string;
  agentId: string;
  ownerSub: string;
  sessionId: string | null;
  payload: ApprovalPayload;
  expiresAt: Date;
}

interface RawPending {
  id: string;
  type: string;
  instanceId: string;
  agentId: string;
  ownerSub: string;
  sessionId: string | null;
  payload: unknown;
  createdAt: Date;
  expiresAt: Date;
  resolvedAt: Date | null;
  verdict: string | null;
  decidedBy: string | null;
  status: string;
  deliveredAt: Date | null;
}

/** Default cap when the caller doesn't specify, and the hard ceiling
 *  regardless of what they ask for. Keeps the inbox bounded as resolved
 *  rows accumulate over the lifetime of an account. */
const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 500;

function clampLimit(requested: number | undefined): number {
  if (requested === undefined) return DEFAULT_LIST_LIMIT;
  if (requested < 1) return DEFAULT_LIST_LIMIT;
  return Math.min(requested, MAX_LIST_LIMIT);
}

function toPendingRow(r: RawPending): PendingApprovalRow {
  return {
    id: r.id,
    type: r.type as ApprovalType,
    instanceId: r.instanceId,
    agentId: r.agentId,
    ownerSub: r.ownerSub,
    sessionId: r.sessionId,
    payload: r.payload as ApprovalPayload,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    resolvedAt: r.resolvedAt,
    verdict: r.verdict as PendingApprovalRow["verdict"],
    decidedBy: r.decidedBy,
    status: r.status as ApprovalStatus,
    deliveredAt: r.deliveredAt,
  };
}

export function createApprovalsRepository(db: Db): ApprovalsRepository {
  return {
    async insertPending(row) {
      // Idempotent on id so the relay can re-emit the same acp_native row on
      // every channel re-engagement without duplicating; ext_authz uses a
      // fresh UUID per request so the conflict path is unreachable for it.
      await db.insert(pendingApprovals).values({
        id: row.id,
        type: row.type,
        instanceId: row.instanceId,
        agentId: row.agentId,
        ownerSub: row.ownerSub,
        sessionId: row.sessionId,
        payload: row.payload,
        expiresAt: row.expiresAt,
      }).onConflictDoNothing();
    },

    async getPending(id) {
      const rows = await db.select().from(pendingApprovals).where(eq(pendingApprovals.id, id));
      return rows.length ? toPendingRow(rows[0] as RawPending) : null;
    },

    async listPendingForOwner(ownerSub, opts) {
      const limit = clampLimit(opts?.limit);
      const where = opts?.status
        ? and(eq(pendingApprovals.ownerSub, ownerSub), eq(pendingApprovals.status, opts.status))
        : eq(pendingApprovals.ownerSub, ownerSub);
      const rows = await db
        .select()
        .from(pendingApprovals)
        .where(where)
        .orderBy(desc(pendingApprovals.createdAt))
        .limit(limit);
      return rows.map((r) => toPendingRow(r as RawPending));
    },

    async listPendingForInstance(instanceId, opts) {
      const limit = clampLimit(opts?.limit);
      const where = opts?.status
        ? and(eq(pendingApprovals.instanceId, instanceId), eq(pendingApprovals.status, opts.status))
        : eq(pendingApprovals.instanceId, instanceId);
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
      await db.update(pendingApprovals)
        .set({
          status: "resolved",
          verdict,
          decidedBy,
          resolvedAt: now,
          ...(opts?.markDelivered ? { deliveredAt: now } : {}),
        })
        .where(and(eq(pendingApprovals.id, id), eq(pendingApprovals.status, "pending")));
    },

    async markDelivered(id) {
      await db.update(pendingApprovals)
        .set({ deliveredAt: new Date() })
        .where(and(
          eq(pendingApprovals.id, id),
          eq(pendingApprovals.status, "resolved"),
          isNull(pendingApprovals.deliveredAt),
        ));
    },

    async listResolvedUndelivered({ staleMs, limit }) {
      const cutoff = new Date(Date.now() - staleMs);
      const rows = await db
        .select()
        .from(pendingApprovals)
        .where(and(
          eq(pendingApprovals.status, "resolved"),
          isNull(pendingApprovals.deliveredAt),
          lt(pendingApprovals.resolvedAt, cutoff),
        ))
        .orderBy(asc(pendingApprovals.resolvedAt))
        .limit(limit);
      return rows.map((r) => toPendingRow(r as RawPending));
    },

    async expirePending(id) {
      await db.update(pendingApprovals)
        .set({ status: "expired", resolvedAt: new Date() })
        .where(and(eq(pendingApprovals.id, id), eq(pendingApprovals.status, "pending")));
    },

    async expireOverdue(now) {
      const rows = await db.update(pendingApprovals)
        .set({ status: "expired", resolvedAt: now })
        .where(and(
          eq(pendingApprovals.status, "pending"),
          sql`${pendingApprovals.expiresAt} < ${now}`,
        ))
        .returning({ id: pendingApprovals.id });
      return rows.map((r) => r.id);
    },
  };
}
