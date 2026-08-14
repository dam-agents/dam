import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createExtAuthzGate } from "../../modules/approvals/services/ext-authz-gate.js";
import type { ApprovalsRepository } from "../../modules/approvals/infrastructure/approvals-repository.js";
import type { RedisBus, BusListener } from "../../core/redis-bus.js";
import type { PendingApprovalRow } from "../../modules/approvals/domain/types.js";

interface FakeRepo {
  repo: ApprovalsRepository;
  rows: PendingApprovalRow[];
  inserts: number;
  expirePendingCalls: string[];
  setInitial(row: PendingApprovalRow): void;
  resolve(id: string, verdict: "allow" | "deny"): void;
}

function makeFakeRepo(): FakeRepo {
  const rows: PendingApprovalRow[] = [];
  const expirePendingCalls: string[] = [];
  let inserts = 0;
  const repo: ApprovalsRepository = {
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
    },
    getPending: async (id) => rows.find((r) => r.id === id) ?? null,
    findActivePendingExtAuthz: async ({ agentId, host, method, path }) => {
      return (
        rows.find(
          (r) =>
            r.agentId === agentId &&
            r.status === "pending" &&
            r.type === "ext_authz" &&
            r.payload.kind === "ext_authz" &&
            r.payload.host === host &&
            r.payload.method === method &&
            r.payload.path === path,
        ) ?? null
      );
    },
    listPendingForOwner: async () => [],
    listPendingForInstance: async () => [],
    resolvePending: async () => true,
    resolveExpired: async () => {},
    markDelivered: async () => {},
    listResolvedUndelivered: async () => [],
    expirePending: async (id) => {
      expirePendingCalls.push(id);
    },
    expireOverdue: async () => [],
    deleteForAgent: async () => {},
    listDistinctAgentIds: async () => [],
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

interface FakeBus {
  bus: RedisBus;
  publishes: { channel: string; payload: string }[];
  fire(channel: string, payload: string): void;
}

function makeFakeBus(): FakeBus {
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

const identityResolver = {
  resolve: async (agentId: string) =>
    agentId === "missing" ? null : { ownerSub: "user-1", agentId: "agent-1" },
};

const noMatchRules = { match: async () => null };

const attended = {
  hasOpenChannelTurn: async () => false,
  hasInteractiveSession: async () => false,
};

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe("ext-authz gate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the matched verdict without writing a pending row", async () => {
    const repo = makeFakeRepo();
    const bus = makeFakeBus();
    const gate = createExtAuthzGate({
      repo: repo.repo,
      bus: bus.bus,
      attendance: attended,
      identityResolver,
      ruleMatcher: { match: async () => ({ verdict: "allow" }) },
      holdSeconds: 30,
      platformAllowedHosts: [],
    });

    const verdict = await gate.gateRequest({
      agentId: "inst-1",
      host: "api.x",
      method: "GET",
      path: "/",
    });

    expect(verdict).toBe("allow");
    expect(repo.inserts).toBe(0);
    expect(bus.publishes).toHaveLength(0);
  });

  it("denies when identity can't be resolved", async () => {
    const repo = makeFakeRepo();
    const bus = makeFakeBus();
    const gate = createExtAuthzGate({
      repo: repo.repo,
      bus: bus.bus,
      attendance: attended,
      identityResolver,
      ruleMatcher: noMatchRules,
      holdSeconds: 30,
      platformAllowedHosts: [],
    });

    const verdict = await gate.gateRequest({
      agentId: "missing",
      host: "x",
      method: "GET",
      path: "/",
    });

    expect(verdict).toBe("deny");
    expect(repo.inserts).toBe(0);
  });

  it("inserts a pending row, publishes the synth frame, and waits for verdict via bus", async () => {
    const repo = makeFakeRepo();
    const bus = makeFakeBus();
    const gate = createExtAuthzGate({
      repo: repo.repo,
      bus: bus.bus,
      attendance: attended,
      identityResolver,
      ruleMatcher: noMatchRules,
      holdSeconds: 30,
      platformAllowedHosts: [],
    });

    const inflight = gate.gateRequest({
      agentId: "inst-1",
      host: "h",
      method: "GET",
      path: "/p",
    });
    await flushMicrotasks();

    expect(repo.inserts).toBe(1);
    expect(bus.publishes).toHaveLength(1);
    expect(bus.publishes[0].channel).toBe("inject:agent-1");

    const id = repo.rows[0].id;
    repo.resolve(id, "allow");
    bus.fire(`approval:${id}`, "");

    expect(await inflight).toBe("allow");
  });

  it("hold-timeout denies the held call and marks the row expired", async () => {
    const repo = makeFakeRepo();
    const bus = makeFakeBus();
    const gate = createExtAuthzGate({
      repo: repo.repo,
      bus: bus.bus,
      attendance: attended,
      identityResolver,
      ruleMatcher: noMatchRules,
      holdSeconds: 30,
      platformAllowedHosts: [],
    });

    const inflight = gate.gateRequest({
      agentId: "inst-1",
      host: "h",
      method: "GET",
      path: "/p",
    });
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(30_000);

    expect(await inflight).toBe("deny");
    expect(repo.expirePendingCalls).toEqual([repo.rows[0].id]);
  });

  it("dedupes retries against an existing pending row of the same shape (#4)", async () => {
    const repo = makeFakeRepo();
    const bus = makeFakeBus();
    const gate = createExtAuthzGate({
      repo: repo.repo,
      bus: bus.bus,
      attendance: attended,
      identityResolver,
      ruleMatcher: noMatchRules,
      holdSeconds: 30,
      platformAllowedHosts: [],
    });

    const first = gate.gateRequest({
      agentId: "inst-1",
      host: "h",
      method: "GET",
      path: "/p",
    });
    await flushMicrotasks();
    expect(repo.inserts).toBe(1);
    expect(bus.publishes).toHaveLength(1);
    const id = repo.rows[0].id;

    const retry = gate.gateRequest({
      agentId: "inst-1",
      host: "h",
      method: "GET",
      path: "/p",
    });
    await flushMicrotasks();

    expect(repo.inserts).toBe(1);
    expect(bus.publishes).toHaveLength(1);

    repo.resolve(id, "allow");
    bus.fire(`approval:${id}`, "");
    expect(await first).toBe("allow");
    expect(await retry).toBe("allow");
  });

  it("allows a platform-provided host without consulting rules or holding", async () => {
    const repo = makeFakeRepo();
    const bus = makeFakeBus();
    const ruleMatch = vi.fn(async () => null);
    const gate = createExtAuthzGate({
      repo: repo.repo,
      bus: bus.bus,
      attendance: attended,
      identityResolver,
      ruleMatcher: { match: ruleMatch },
      holdSeconds: 30,
      platformAllowedHosts: ["platform-seaweedfs.platform.svc.cluster.local"],
    });

    const verdict = await gate.gateRequest({
      agentId: "inst-1",
      host: "platform-seaweedfs.platform.svc.cluster.local",
      method: "PUT",
      path: "/platform-artifacts/exp/agent/u/c.bin",
    });

    expect(verdict).toBe("allow");
    expect(ruleMatch).not.toHaveBeenCalled();
    expect(repo.inserts).toBe(0);
    expect(bus.publishes).toHaveLength(0);
  });

  it("still fails closed on unresolved identity even for a platform host", async () => {
    const repo = makeFakeRepo();
    const bus = makeFakeBus();
    const gate = createExtAuthzGate({
      repo: repo.repo,
      bus: bus.bus,
      attendance: attended,
      identityResolver,
      ruleMatcher: noMatchRules,
      holdSeconds: 30,
      platformAllowedHosts: ["store.internal"],
    });

    const verdict = await gate.gateRequest({
      agentId: "missing",
      host: "store.internal",
      method: "PUT",
      path: "/b/k",
    });

    expect(verdict).toBe("deny");
  });

  describe("unattended channel turns", () => {
    const unattended = {
      hasOpenChannelTurn: async () => true,
      hasInteractiveSession: async () => false,
    };

    it("denies at once instead of holding, and records the row for the inbox", async () => {
      const repo = makeFakeRepo();
      const bus = makeFakeBus();
      const gate = createExtAuthzGate({
        repo: repo.repo,
        bus: bus.bus,
        attendance: unattended,
        identityResolver,
        ruleMatcher: noMatchRules,
        holdSeconds: 1800,
        platformAllowedHosts: [],
      });

      const verdict = await gate.gateRequest({
        agentId: "inst-1",
        host: "h",
        method: "GET",
        path: "/p",
      });

      expect(verdict).toBe("deny");
      expect(repo.inserts).toBe(1);
      expect(repo.rows[0].status).toBe("pending");
      expect(repo.expirePendingCalls).toHaveLength(0);
    });

    it("publishes no in-session prompt — nothing is attached to consume it", async () => {
      const repo = makeFakeRepo();
      const bus = makeFakeBus();
      const gate = createExtAuthzGate({
        repo: repo.repo,
        bus: bus.bus,
        attendance: unattended,
        identityResolver,
        ruleMatcher: noMatchRules,
        holdSeconds: 1800,
        platformAllowedHosts: [],
      });

      await gate.gateRequest({
        agentId: "inst-1",
        host: "h",
        method: "GET",
        path: "/p",
      });

      expect(bus.publishes).toHaveLength(0);
    });

    it("reuses one row across retries so the inbox gets a single entry", async () => {
      const repo = makeFakeRepo();
      const bus = makeFakeBus();
      const gate = createExtAuthzGate({
        repo: repo.repo,
        bus: bus.bus,
        attendance: unattended,
        identityResolver,
        ruleMatcher: noMatchRules,
        holdSeconds: 1800,
        platformAllowedHosts: [],
      });

      const request = {
        agentId: "inst-1",
        host: "h",
        method: "GET",
        path: "/p",
      };
      expect(await gate.gateRequest(request)).toBe("deny");
      expect(await gate.gateRequest(request)).toBe("deny");
      expect(await gate.gateRequest(request)).toBe("deny");

      expect(repo.inserts).toBe(1);
    });

    it("holds as usual when an interactive session is attached alongside", async () => {
      const repo = makeFakeRepo();
      const bus = makeFakeBus();
      const gate = createExtAuthzGate({
        repo: repo.repo,
        bus: bus.bus,
        attendance: {
          hasOpenChannelTurn: async () => true,
          hasInteractiveSession: async () => true,
        },
        identityResolver,
        ruleMatcher: noMatchRules,
        holdSeconds: 30,
        platformAllowedHosts: [],
      });

      const inflight = gate.gateRequest({
        agentId: "inst-1",
        host: "h",
        method: "GET",
        path: "/p",
      });
      await flushMicrotasks();

      expect(bus.publishes).toHaveLength(1);

      const id = repo.rows[0].id;
      repo.resolve(id, "allow");
      bus.fire(`approval:${id}`, "");

      expect(await inflight).toBe("allow");
    });

    it("never reaches the attendance check when a rule already decides", async () => {
      const repo = makeFakeRepo();
      const bus = makeFakeBus();
      const hasOpenChannelTurn = vi.fn(async () => true);
      const gate = createExtAuthzGate({
        repo: repo.repo,
        bus: bus.bus,
        attendance: {
          hasOpenChannelTurn,
          hasInteractiveSession: async () => false,
        },
        identityResolver,
        ruleMatcher: { match: async () => ({ verdict: "allow" }) },
        holdSeconds: 1800,
        platformAllowedHosts: [],
      });

      expect(
        await gate.gateRequest({
          agentId: "inst-1",
          host: "allowed.example",
          method: "GET",
          path: "/",
        }),
      ).toBe("allow");
      expect(hasOpenChannelTurn).not.toHaveBeenCalled();
    });
  });
});
