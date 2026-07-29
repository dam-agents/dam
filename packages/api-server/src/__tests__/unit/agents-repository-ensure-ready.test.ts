import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createAgentsRepository } from "../../modules/agents/infrastructure/agents-repository.js";
import type {
  K8sClient,
  KubeObject,
} from "../../modules/agents/infrastructure/k8s.js";
import { isAgentWakeTimeoutError } from "../../modules/agents/domain/wake-failure.js";
import { isAgentStoppedError } from "../../modules/agents/domain/agent-stopped.js";
import { configureLogger } from "../../core/logger.js";

type Condition = {
  type: string;
  status: string;
  reason?: string;
  message?: string;
};

/** In-memory K8sClient over a Map — the five custom-object methods the
 *  repository uses. Merge-patch is shallow-merged per subtree, which is
 *  all the repository's annotation/spec patches need. */
function fakeK8s(initial: KubeObject[] = []) {
  const store = new Map<string, KubeObject>();
  for (const o of initial) store.set(o.metadata?.name ?? "", o);
  const client: K8sClient = {
    namespace: "test-agents",
    async readAgentPodRestart() {
      return null;
    },
    async getCustomObject(_plural, name) {
      return store.get(name) ?? null;
    },
    async listCustomObjects() {
      return [...store.values()];
    },
    async createCustomObject(_plural, body) {
      const obj = body as KubeObject;
      store.set(obj.metadata?.name ?? "", obj);
      return obj;
    },
    async patchCustomObject(_plural, name, body) {
      const existing = store.get(name);
      if (!existing) throw new Error(`404: ${name}`);
      const patch = body as KubeObject;
      const merged: KubeObject = {
        ...existing,
        ...(patch.metadata
          ? {
              metadata: {
                ...existing.metadata,
                ...patch.metadata,
                annotations: {
                  ...existing.metadata?.annotations,
                  ...patch.metadata.annotations,
                },
              },
            }
          : {}),
      };
      store.set(name, merged);
      return merged;
    },
    async deleteCustomObject(_plural, name) {
      store.delete(name);
    },
    // Secret methods are on the interface but never reached by the
    // repository under test.
    listSecrets: () => Promise.reject(new Error("not implemented")),
    getSecret: () => Promise.reject(new Error("not implemented")),
    createSecret: () => Promise.reject(new Error("not implemented")),
    replaceSecret: () => Promise.reject(new Error("not implemented")),
    deleteSecret: () => Promise.reject(new Error("not implemented")),
  };
  return { client, store };
}

function agentObj(name: string, conditions: Condition[]): KubeObject {
  return {
    metadata: { name, annotations: {} },
    spec: { name },
    status: { conditions },
  } as KubeObject;
}

const READY: Condition[] = [{ type: "Ready", status: "True" }];
const HIBERNATED: Condition[] = [
  { type: "Ready", status: "False", reason: "Hibernated" },
];
const OVER_BUDGET: Condition[] = [
  {
    type: "Ready",
    status: "False",
    reason: "OverBudget",
    message: "4.5/4 CPU — stop a running sandbox to free room",
  },
];

function harness(initial: KubeObject[]) {
  const lines: Array<Record<string, unknown>> = [];
  configureLogger({ level: "info", write: (l) => lines.push(JSON.parse(l)) });
  const { client, store } = fakeK8s(initial);
  const repo = createAgentsRepository(client);
  return { repo, store, lines };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** Advance fake time in chunks until the promise settles. A single big
 *  advance can miss a poll timer scheduled at the window's edge; chunked
 *  advancing re-collects due timers each pass. */
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
    const { repo, store, lines } = harness([agentObj("a1", READY)]);
    await repo.ensureReady("a1");
    expect(
      store.get("a1")?.metadata?.annotations?.[
        "agent-platform.ai/last-activity"
      ],
    ).toBeTruthy();
    expect(lines.map((l) => l.msg)).not.toContain("agent.wake.begin");
  });

  it("wake success logs agent.wake.ready with duration", async () => {
    const { repo, store, lines } = harness([agentObj("a1", HIBERNATED)]);
    const p = repo.ensureReady("a1");
    await vi.advanceTimersByTimeAsync(5_000);
    store.set("a1", agentObj("a1", READY));
    await vi.advanceTimersByTimeAsync(10_000);
    await p;
    const ready = lines.find((l) => l.msg === "agent.wake.ready");
    expect(ready).toBeDefined();
    expect(ready?.agentId).toBe("a1");
    expect(typeof ready?.durationMs).toBe("number");
    expect(lines.map((l) => l.msg)).toContain("agent.wake.begin");
  });

  it("onWaking fires on the slow path and for joiners, not when ready", async () => {
    const { repo, store } = harness([agentObj("a1", HIBERNATED)]);
    let notices = 0;
    const p1 = repo.ensureReady("a1", { onWaking: () => notices++ });
    const p2 = repo.ensureReady("a1", { onWaking: () => notices++ });
    // Let the wake enter its poll (stop-check + readiness reads are awaits)
    // before flipping the store to READY — mirrors real ordering, where no
    // K8s read resolves synchronously.
    await vi.advanceTimersByTimeAsync(0);
    store.set("a1", agentObj("a1", READY));
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.all([p1, p2]);
    expect(notices).toBe(2);

    await repo.ensureReady("a1", { onWaking: () => notices++ });
    expect(notices).toBe(2);
  });

  const timeoutCases: Array<{
    name: string;
    conditions: Condition[];
    kind: string;
    logCause: string;
  }> = [
    {
      name: "still Hibernated → hibernated-not-scaled",
      conditions: HIBERNATED,
      kind: "hibernated-not-scaled",
      logCause: "wake-timeout:hibernated-not-scaled",
    },
    {
      name: "ImagePullFailure → agent-pod-failed",
      conditions: [
        { type: "Ready", status: "False", reason: "PodsNotReady" },
        {
          type: "AgentPodReady",
          status: "False",
          reason: "ImagePullFailure",
          message: "can't pull image (check the registry credential)",
        },
      ],
      kind: "agent-pod-failed",
      logCause: "wake-timeout:agent-pod-failed:ImagePullFailure",
    },
    {
      name: "plain PodNotReady → agent-pod-not-ready (progressing)",
      conditions: [
        { type: "Ready", status: "False", reason: "PodsNotReady" },
        { type: "AgentPodReady", status: "False", reason: "PodNotReady" },
      ],
      kind: "agent-pod-not-ready",
      logCause: "wake-timeout:agent-pod-not-ready",
    },
    {
      name: "gateway lagging → gateway-not-ready",
      conditions: [
        { type: "Ready", status: "False", reason: "PodsNotReady" },
        { type: "AgentPodReady", status: "True", reason: "PodReady" },
        { type: "GatewayPodReady", status: "False", reason: "PodNotReady" },
      ],
      kind: "gateway-not-ready",
      logCause: "wake-timeout:gateway-not-ready",
    },
    {
      name: "reconcile error → reconcile-error",
      conditions: [
        { type: "Ready", status: "False", reason: "PodsNotReady" },
        {
          type: "Reconciled",
          status: "False",
          reason: "ReconcileError",
          message: "applying statefulset: boom",
        },
      ],
      kind: "reconcile-error",
      logCause: "wake-timeout:reconcile-error",
    },
  ];

  for (const { name, conditions, kind, logCause } of timeoutCases) {
    it(`timeout: ${name}`, async () => {
      const { repo, lines } = harness([agentObj("a1", conditions)]);
      const p = repo.ensureReady("a1");
      p.catch(() => {}); // avoid unhandled rejection while timers advance
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

  it("timeout with the CR deleted mid-wake → not-found", async () => {
    const { repo, store } = harness([agentObj("a1", HIBERNATED)]);
    const p = repo.ensureReady("a1");
    p.catch(() => {});
    store.delete("a1");
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
    // The regression this guards (#2768 review must-fix 2): a parked agent
    // keeps Ready=False/OverBudget standing, so a fresh wake's first poll
    // tick reads the PREVIOUS attempt's denial. The heuristic — fail fast
    // only on a denial observed to appear during this wake, or after the
    // grace window — must let this wake ride through to the controller's
    // re-evaluation instead of failing a start that room now permits.
    const { repo, store } = harness([agentObj("a1", OVER_BUDGET)]);
    const p = repo.ensureReady("a1");
    await vi.advanceTimersByTimeAsync(0); // tick 0 sees the stale denial
    store.set("a1", agentObj("a1", READY)); // controller admits: room is free
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(p).resolves.toBeUndefined();
  });

  it("fail-fast: a denial that appears during the wake rejects immediately", async () => {
    // Hibernated at wake time, then the controller rules on our bump and
    // parks us — a transition this wake itself observed is a fresh verdict,
    // no grace needed.
    const { repo, store, lines } = harness([agentObj("a1", HIBERNATED)]);
    const p = repo.ensureReady("a1");
    p.catch(() => {});
    await vi.advanceTimersByTimeAsync(0); // wake begins; tick 0 sees Hibernated
    store.set("a1", agentObj("a1", OVER_BUDGET));
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
    // Already parked and the controller keeps refusing (or is wedged):
    // once the grace passes, waiting out the full 120s budget helps nobody.
    const { repo } = harness([agentObj("a1", OVER_BUDGET)]);
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
    const { repo, store } = harness([agentObj("a1", HIBERNATED)]);
    const p = repo.ensureReady("a1");
    p.catch(() => {});
    await vi.advanceTimersByTimeAsync(0); // past the entry stop-check
    const obj = store.get("a1");
    obj!.metadata!.annotations!["agent-platform.ai/stop-requested"] =
      "2026-07-14T00:00:00Z";
    await advanceUntilSettled(p);
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(isAgentStoppedError(err)).toBe(true);
    // ensureReady bumps activity but must not touch the stop key — only
    // wake()/wakeIfHibernated() clear a stop.
    expect(
      store.get("a1")?.metadata?.annotations?.[
        "agent-platform.ai/stop-requested"
      ],
    ).toBe("2026-07-14T00:00:00Z");
  });

  it("late ready at the deadline counts as success", async () => {
    const { store, lines } = harness([agentObj("a1", HIBERNATED)]);
    // Never Ready during the poll; flip Ready just as the deadline passes
    // by making the final read see a Ready CR: replace isReady's view via
    // a poll that always misses, then set Ready right before the final GET.
    const original = store.get("a1")!;
    let polls = 0;
    const { client } = (() => {
      const inner = fakeK8s([original]);
      const wrapped: K8sClient = {
        ...inner.client,
        async getCustomObject(plural, name) {
          polls++;
          // The poll loop's reads miss; once the deadline passed (fake
          // clock ≥ 120s), the final diagnostic read sees Ready.
          if (Date.now() >= 120_000) {
            return agentObj("a1", READY);
          }
          return inner.client.getCustomObject(plural, name);
        },
      };
      return { client: wrapped };
    })();
    vi.setSystemTime(0);
    const repo2 = createAgentsRepository(client);
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
    const { repo, store } = harness([agentObj("a1", READY)]);
    const infra = await repo.requestPause("a1");
    expect(infra).not.toBeNull();
    const ann = () => store.get("a1")?.metadata?.annotations ?? {};
    expect(ann()[STOP_KEY]).toBeTruthy();
    // Controller scales the pair down and restamps Hibernated.
    (store.get("a1") as { status?: unknown }).status = {
      conditions: HIBERNATED,
    };
    await vi.advanceTimersByTimeAsync(5_000);
    expect(ann()[STOP_KEY]).toBe("");
  });

  it("leaves a stop stamped during the settle window in place", async () => {
    // Pause's settle-watcher must compare-and-clear its OWN stamp: a stop
    // issued mid-settle carries a different value and must stay sticky, or
    // the pair would revive under the wake's fresh last-activity.
    const { repo, store } = harness([agentObj("a1", READY)]);
    await repo.requestPause("a1");
    const obj = store.get("a1");
    obj!.metadata!.annotations![STOP_KEY] = "9999-01-01T00:00:00Z";
    (obj as { status?: unknown }).status = { conditions: HIBERNATED };
    await vi.advanceTimersByTimeAsync(65_000);
    expect(store.get("a1")?.metadata?.annotations?.[STOP_KEY]).toBe(
      "9999-01-01T00:00:00Z",
    );
  });
});
