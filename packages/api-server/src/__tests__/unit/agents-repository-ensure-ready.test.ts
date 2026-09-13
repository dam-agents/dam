import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createAgentsRepository } from "../../modules/agents/infrastructure/agents-repository.js";
import { fakeAgentStore } from "../helpers/fake-agent-store.js";
import type {
  AgentRecord,
  AgentStatus,
  AgentStore,
} from "../../modules/agents/infrastructure/agent-store.js";
import { isAgentWakeTimeoutError } from "../../modules/agents/domain/wake-failure.js";
import { isAgentStoppedError } from "../../modules/agents/domain/agent-stopped.js";
import { configureLogger } from "../../core/logger.js";

function agentRec(name: string, status: AgentStatus): AgentRecord {
  return {
    id: name,
    owner: "owner-1",
    annotations: {},
    spec: { image: "x", name },
    status,
    assignedNode: "node-1",
    lastNode: null,
  };
}

const READY: AgentStatus = { ready: true };
const HIBERNATED: AgentStatus = { ready: false, hibernated: true };
const OVER_BUDGET: AgentStatus = {
  ready: false,
  overBudget: true,
  overBudgetMessage: "4.5/4 CPU — stop a running agent to free room",
};

function harness(initial: AgentRecord[]) {
  const lines: Array<Record<string, unknown>> = [];
  configureLogger({ level: "info", write: (l) => lines.push(JSON.parse(l)) });
  const { store, records } = fakeAgentStore(initial);
  return { repo: createAgentsRepository(store), store, records, lines };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function advanceUntilSettled(p: Promise<unknown>): Promise<void> {
  let settled = false;
  void p.then(
    () => (settled = true),
    () => (settled = true),
  );
  for (let i = 0; i < 80 && !settled; i++) {
    await vi.advanceTimersByTimeAsync(5_000);
  }
}

describe("ensureReady", () => {
  it("fast path: already ready bumps last-activity without polling", async () => {
    const { repo, records, lines } = harness([agentRec("a1", READY)]);
    await repo.ensureReady("a1");
    expect(
      records.get("a1")?.annotations["agent-platform.ai/last-activity"],
    ).toBeTruthy();
    expect(lines.map((l) => l.msg)).not.toContain("agent.wake.begin");
  });

  it("wake success logs agent.wake.ready with duration", async () => {
    const { repo, records, lines } = harness([agentRec("a1", HIBERNATED)]);
    const p = repo.ensureReady("a1");
    await vi.advanceTimersByTimeAsync(5_000);
    records.set("a1", agentRec("a1", READY));
    await vi.advanceTimersByTimeAsync(10_000);
    await p;
    const ready = lines.find((l) => l.msg === "agent.wake.ready");
    expect(ready).toBeDefined();
    expect(ready?.agentId).toBe("a1");
    expect(typeof ready?.durationMs).toBe("number");
    expect(lines.map((l) => l.msg)).toContain("agent.wake.begin");
  });

  it("onWaking fires on the slow path and for joiners, not when ready", async () => {
    const { repo, records } = harness([agentRec("a1", HIBERNATED)]);
    let notices = 0;
    const p1 = repo.ensureReady("a1", { onWaking: () => notices++ });
    const p2 = repo.ensureReady("a1", { onWaking: () => notices++ });
    await vi.advanceTimersByTimeAsync(0);
    records.set("a1", agentRec("a1", READY));
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.all([p1, p2]);
    expect(notices).toBe(2);

    await repo.ensureReady("a1", { onWaking: () => notices++ });
    expect(notices).toBe(2);
  });

  const timeoutCases: Array<{
    name: string;
    status: AgentStatus;
    kind: string;
    logCause: string;
  }> = [
    {
      name: "still Hibernated → hibernated-not-started",
      status: HIBERNATED,
      kind: "hibernated-not-started",
      logCause: "wake-timeout:hibernated-not-started",
    },
    {
      name: "ImagePullFailure → sandbox-failed",
      status: {
        ready: false,
        error: "pulling img: 401",
        errorReason: "ImagePullFailure",
      },
      kind: "sandbox-failed",
      logCause: "wake-timeout:sandbox-failed:ImagePullFailure",
    },
    {
      name: "plain not-ready → sandbox-not-ready (progressing)",
      status: {
        ready: false,
        sandboxReady: false,
        sandboxNotReadyReason: "SandboxNotReady",
      },
      kind: "sandbox-not-ready",
      logCause: "wake-timeout:sandbox-not-ready",
    },
    {
      name: "gateway lagging → gateway-not-ready",
      status: {
        ready: false,
        sandboxReady: true,
        gatewayReady: false,
        gatewayNotReadyReason: "GatewayNotReady",
      },
      kind: "gateway-not-ready",
      logCause: "wake-timeout:gateway-not-ready",
    },
    {
      name: "reconcile error → reconcile-error",
      status: {
        ready: false,
        error: "creating the sandbox: boom",
        errorReason: "ReconcileError",
      },
      kind: "reconcile-error",
      logCause: "wake-timeout:reconcile-error",
    },
  ];

  for (const { name, status, kind, logCause } of timeoutCases) {
    it(`timeout: ${name}`, async () => {
      const { repo, lines } = harness([agentRec("a1", status)]);
      const p = repo.ensureReady("a1");
      p.catch(() => {});
      await advanceUntilSettled(p);
      const err = await p.then(
        () => null,
        (e: unknown) => e,
      );
      expect(isAgentWakeTimeoutError(err)).toBe(true);
      if (isAgentWakeTimeoutError(err)) {
        expect(err.failure.kind).toBe(kind);
        expect(err.durationMs).toBeGreaterThanOrEqual(120_000);
      }
      const warn = lines.find((l) => l.msg === "agent.wake.timeout");
      expect(warn?.cause).toBe(logCause);
    });
  }

  // TEST_SCENARIO: the record still says ready because the node that published it has stopped heartbeating. Nothing will answer a dial there, so the wait must not take the stale flag at its word — it times out with the node named as the cause instead of handing the caller a connection to nowhere.
  it("does not trust a ready flag published by a node that went quiet", async () => {
    const { store, lines } = harness([agentRec("a1", READY)]);
    const repo = createAgentsRepository(store, async () => new Set());
    const p = repo.ensureReady("a1");
    p.catch(() => {});
    await advanceUntilSettled(p);
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(isAgentWakeTimeoutError(err)).toBe(true);
    if (isAgentWakeTimeoutError(err)) {
      expect(err.failure.kind).toBe("node-unreachable");
    }
    expect(lines.map((l) => l.msg)).toContain("agent.wake.begin");
  });

  it("timeout with the agent deleted mid-wake → not-found", async () => {
    const { repo, records } = harness([agentRec("a1", HIBERNATED)]);
    const p = repo.ensureReady("a1");
    p.catch(() => {});
    records.delete("a1");
    await advanceUntilSettled(p);
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(isAgentWakeTimeoutError(err)).toBe(true);
    if (isAgentWakeTimeoutError(err)) {
      expect(err.failure.kind).toBe("not-found");
    }
  });

  it("keeps polling past a stale denial and succeeds once the controller admits", async () => {
    const { repo, records } = harness([agentRec("a1", OVER_BUDGET)]);
    const p = repo.ensureReady("a1");
    await vi.advanceTimersByTimeAsync(0);
    records.set("a1", agentRec("a1", READY));
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(p).resolves.toBeUndefined();
  });

  it("fail-fast: a denial that appears during the wake rejects immediately", async () => {
    const { repo, records, lines } = harness([agentRec("a1", HIBERNATED)]);
    const p = repo.ensureReady("a1");
    p.catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    records.set("a1", agentRec("a1", OVER_BUDGET));
    await advanceUntilSettled(p);
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(isAgentWakeTimeoutError(err)).toBe(true);
    if (isAgentWakeTimeoutError(err)) {
      expect(err.failure.kind).toBe("over-budget");
      expect(err.durationMs).toBeLessThan(10_000);
    }
    expect(lines.find((l) => l.msg === "agent.wake.rejected")).toBeDefined();
  });

  it("fail-fast: a standing denial outlasting the grace window rejects with the figures", async () => {
    const { repo } = harness([agentRec("a1", OVER_BUDGET)]);
    const p = repo.ensureReady("a1");
    p.catch(() => {});
    await advanceUntilSettled(p);
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(isAgentWakeTimeoutError(err)).toBe(true);
    if (isAgentWakeTimeoutError(err)) {
      expect(err.failure.kind).toBe("over-budget");
      expect(err.durationMs).toBeGreaterThanOrEqual(10_000);
      expect(err.durationMs).toBeLessThan(120_000);
    }
  });

  it("a stop landing mid-wake fails fast and is never cleared by the wake", async () => {
    const { repo, records } = harness([agentRec("a1", HIBERNATED)]);
    const p = repo.ensureReady("a1");
    p.catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    records.get("a1")!.annotations["agent-platform.ai/stop-requested"] =
      "2026-07-14T00:00:00Z";
    await advanceUntilSettled(p);
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(isAgentStoppedError(err)).toBe(true);
    expect(
      records.get("a1")?.annotations["agent-platform.ai/stop-requested"],
    ).toBe("2026-07-14T00:00:00Z");
  });

  it("late ready at the deadline counts as success", async () => {
    const { store, lines } = harness([agentRec("a1", HIBERNATED)]);
    let polls = 0;
    const wrapped: AgentStore = {
      ...store,
      async get(id) {
        polls++;
        if (Date.now() >= 120_000) return agentRec("a1", READY);
        return store.get(id);
      },
    };
    vi.setSystemTime(0);
    const repo2 = createAgentsRepository(wrapped);
    const p = repo2.ensureReady("a1");
    await advanceUntilSettled(p);
    await expect(p).resolves.toBeUndefined();
    expect(polls).toBeGreaterThan(1);
    expect(lines.find((l) => l.msg === "agent.wake.ready")?.lateReady).toBe(
      true,
    );
  });
});

describe("requestPause settle", () => {
  const STOP_KEY = "agent-platform.ai/stop-requested";

  it("clears its own stop once the controller reports Hibernated", async () => {
    const { repo, records } = harness([agentRec("a1", READY)]);
    const infra = await repo.requestPause("a1");
    expect(infra).not.toBeNull();
    const ann = () => records.get("a1")?.annotations ?? {};
    expect(ann()[STOP_KEY]).toBeTruthy();
    records.get("a1")!.status = HIBERNATED;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(ann()[STOP_KEY]).toBe("");
  });

  it("leaves a stop stamped during the settle window in place", async () => {
    const { repo, records } = harness([agentRec("a1", READY)]);
    await repo.requestPause("a1");
    const record = records.get("a1")!;
    record.annotations[STOP_KEY] = "9999-01-01T00:00:00Z";
    record.status = HIBERNATED;
    await vi.advanceTimersByTimeAsync(65_000);
    expect(records.get("a1")?.annotations[STOP_KEY]).toBe(
      "9999-01-01T00:00:00Z",
    );
  });
});
