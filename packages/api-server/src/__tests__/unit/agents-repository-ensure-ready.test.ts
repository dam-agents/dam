import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createAgentsRepository } from "../../modules/agents/infrastructure/agents-repository.js";
import type {
  K8sClient,
  KubeObject,
} from "../../modules/agents/infrastructure/k8s.js";
import { isAgentWakeTimeoutError } from "../../modules/agents/domain/wake-failure.js";
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
