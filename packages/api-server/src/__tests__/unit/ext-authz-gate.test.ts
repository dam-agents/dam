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
        instanceId: input.instanceId,
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
    resolvePending: async () => {},
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
  resolve: async (instanceId: string) =>
    instanceId === "missing"
      ? null
      : { ownerSub: "user-1", agentId: "agent-1" },
};

const noMatchRules = { match: async () => null };

/** Drain microtasks so all internal awaits inside `gateRequest` settle. */
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
      identityResolver,
      ruleMatcher: { match: async () => ({ verdict: "allow" }) },
      holdSeconds: 30,
    });

    const verdict = await gate.gateRequest({
      instanceId: "inst-1",
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
      identityResolver,
      ruleMatcher: noMatchRules,
      holdSeconds: 30,
    });

    const verdict = await gate.gateRequest({
      instanceId: "missing",
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
      identityResolver,
      ruleMatcher: noMatchRules,
      holdSeconds: 30,
    });

    const inflight = gate.gateRequest({
      instanceId: "inst-1",
      host: "h",
      method: "GET",
      path: "/p",
    });
    // Yield so insertPending + publish run before we resolve.
    await flushMicrotasks();

    expect(repo.inserts).toBe(1);
    expect(bus.publishes).toHaveLength(1);
    expect(bus.publishes[0].channel).toBe("inject:inst-1");

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
      identityResolver,
      ruleMatcher: noMatchRules,
      holdSeconds: 30,
    });

    const inflight = gate.gateRequest({
      instanceId: "inst-1",
      host: "h",
      method: "GET",
      path: "/p",
    });
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(30_000);

    expect(await inflight).toBe("deny");
    // Row's lifecycle tracks the held call: hold-timeout = held call gone =
    // expired. The inbox UI greys out one-shot actions in that state; rule-
    // writing actions (approve permanently / deny forever) still apply
    // because they affect future requests, not this expired row.
    expect(repo.expirePendingCalls).toEqual([repo.rows[0].id]);
  });

  it("dedupes retries against an existing pending row of the same shape (#4)", async () => {
    const repo = makeFakeRepo();
    const bus = makeFakeBus();
    const gate = createExtAuthzGate({
      repo: repo.repo,
      bus: bus.bus,
      identityResolver,
      ruleMatcher: noMatchRules,
      holdSeconds: 30,
    });

    const first = gate.gateRequest({
      instanceId: "inst-1",
      host: "h",
      method: "GET",
      path: "/p",
    });
    await flushMicrotasks();
    expect(repo.inserts).toBe(1);
    expect(bus.publishes).toHaveLength(1);
    const id = repo.rows[0].id;

    // Retry from the agent CLI while the original row is still pending.
    const retry = gate.gateRequest({
      instanceId: "inst-1",
      host: "h",
      method: "GET",
      path: "/p",
    });
    await flushMicrotasks();

    // No second insert; no second synth frame fan-out.
    expect(repo.inserts).toBe(1);
    expect(bus.publishes).toHaveLength(1);

    // Both holds resolve from the same row when the user clicks once.
    repo.resolve(id, "allow");
    bus.fire(`approval:${id}`, "");
    expect(await first).toBe("allow");
    expect(await retry).toBe("allow");
  });
});
