import type { ApprovalsRepository } from "../../modules/approvals/infrastructure/approvals-repository.js";
import type { RedisBus, BusListener } from "../../core/redis-bus.js";
import type { PendingApprovalRow } from "../../modules/approvals/domain/types.js";

export interface FakeRepo {
  repo: ApprovalsRepository;
  rows: PendingApprovalRow[];
  inserts: number;
  expirePendingCalls: string[];
  setInitial(row: PendingApprovalRow): void;
  resolve(id: string, verdict: "allow" | "deny"): void;
}

export function makeFakeApprovalsRepo(): FakeRepo {
  const rows: PendingApprovalRow[] = [];
  const expirePendingCalls: string[] = [];
  let inserts = 0;
  const repo: ApprovalsRepository = {
    insertIfAbsent: async () => true,
    insertSettled: async () => true,
    insertPending: async (input) => {
      inserts++;
      rows.push({
        id: input.id,
        type: input.type,
        agentId: input.agentId,
        ownerSub: input.ownerSub,
        sessionId: input.sessionId,
        payload: input.payload,
        createdAt: new Date(),
        expiresAt: input.expiresAt,
        resolvedAt: null,
        verdict: null,
        decidedBy: null,
        status: "pending",
        deliveredAt: null,
      });
      return true;
    },
    getPending: async (id) => rows.find((r) => r.id === id) ?? null,
    findActivePendingWebSearch: async ({ agentId, key }) =>
      rows.find(
        (r) =>
          r.agentId === agentId &&
          r.status === "pending" &&
          r.payload.kind === "web_search" &&
          r.payload.key === key,
      ) ?? null,
    findActivePendingExtAuthz: async ({
      agentId,
      host,
      port,
      method,
      path,
    }) => {
      return (
        rows.find(
          (r) =>
            r.agentId === agentId &&
            r.status === "pending" &&
            r.type === "ext_authz" &&
            r.payload.kind === "ext_authz" &&
            r.payload.host === host &&
            r.payload.port === port &&
            r.payload.method === method &&
            r.payload.path === path,
        ) ?? null
      );
    },
    listPendingForOwner: async () => [],
    listPendingForInstance: async () => [],
    resolvePending: async () => true,
    resolveExpired: async () => false,
    markDelivered: async () => {},
    correctResolvedVerdict: async () => false,
    listResolvedUndelivered: async () => [],
    expirePending: async (id) => {
      expirePendingCalls.push(id);
      const row = rows.find((r) => r.id === id && r.status === "pending");
      if (!row) return false;
      row.status = "expired";
      return true;
    },
    expireOverdue: async () => [],
    deleteForAgent: async () => {},
    listDistinctAgentIds: async () => [],
    listPendingChildEgressRequests: async () => [],
  };
  return {
    repo,
    rows,
    get inserts() {
      return inserts;
    },
    expirePendingCalls,
    setInitial(row) {
      rows.push(row);
    },
    resolve(id, verdict) {
      const row = rows.find((r) => r.id === id);
      if (!row) return;
      row.status = "resolved";
      row.verdict = verdict === "allow" ? "allow" : "deny";
      row.resolvedAt = new Date();
    },
  } as FakeRepo;
}

export interface FakeBus {
  bus: RedisBus;
  publishes: { channel: string; payload: string }[];
  fire(channel: string, payload: string): void;
}

export function makeFakeApprovalsBus(): FakeBus {
  const subs = new Map<string, Set<BusListener>>();
  const publishes: { channel: string; payload: string }[] = [];
  return {
    bus: {
      publish: async (channel, payload) => {
        publishes.push({ channel, payload });
      },
      subscribe: (channel, listener) => {
        let set = subs.get(channel);
        if (!set) {
          set = new Set();
          subs.set(channel, set);
        }
        set.add(listener);
        return () => {
          set!.delete(listener);
        };
      },
      close: async () => {},
    },
    publishes,
    fire(channel, payload) {
      const set = subs.get(channel);
      if (!set) return;
      for (const fn of set) fn(payload);
    },
  };
}
