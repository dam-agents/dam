import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createAgentsRepository } from "../../modules/agents/infrastructure/agents-repository.js";
import { fakeK8s } from "../helpers/fake-k8s.js";
import { createLiveAgentStateCache } from "../../modules/agents/infrastructure/agent-state-cache.js";
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
const AWAITING_ALLOCATION: Condition[] = [
  {
    type: "Ready",
    status: "False",
    reason: "AwaitingAllocation",
    message:
      "Your VM agent is waiting for the node to grant its runner the memory this start needs. It starts on its own as soon as the node does.",
  },
  {
    type: "AgentPodReady",
    status: "False",
    reason: "AwaitingAllocation",
    message:
      "Your VM agent is waiting for the node to grant its runner the memory this start needs. It starts on its own as soon as the node does.",
  },
];
const AWAITING_WARM_UP: Condition[] = [
  {
    type: "Ready",
    status: "False",
    reason: "AwaitingWarmUp",
    message:
      "Your VM agents are still starting up after their runner restarted, so this one waits for them to settle instead of putting one of them to sleep. It starts on its own once room frees up.",
  },
  {
    type: "AgentPodReady",
    status: "False",
    reason: "AwaitingWarmUp",
    message:
      "Your VM agents are still starting up after their runner restarted, so this one waits for them to settle instead of putting one of them to sleep. It starts on its own once room frees up.",
  },
];
const OVER_BUDGET: Condition[] = [
  {
    type: "Ready",
    status: "False",
    reason: "OverBudget",
    message: "4.5/4 CPU — stop a running agent to free room",
  },
];

function harness(initial: KubeObject[]) {
  const lines: Array<Record<string, unknown>> = [];
  configureLogger({ level: "info", write: (l) => lines.push(JSON.parse(l)) });
  const { client, store } = fakeK8s(initial);
  const repo = createAgentsRepository(
    client,
    createLiveAgentStateCache(client),
  );
  return { repo, store, lines };
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
      name: "ImagePullFailure → agent-start-failed",
      conditions: [
        { type: "Ready", status: "False", reason: "PodsNotReady" },
        {
          type: "AgentPodReady",
          status: "False",
          reason: "ImagePullFailure",
          message: "can't pull image (check the registry credential)",
        },
      ],
      kind: "agent-start-failed",
      logCause: "wake-timeout:agent-pod-failed:ImagePullFailure",
    },
    {
      name: "plain PodNotReady → agent-not-ready (progressing)",
      conditions: [
        { type: "Ready", status: "False", reason: "PodsNotReady" },
        { type: "AgentPodReady", status: "False", reason: "PodNotReady" },
      ],
      kind: "agent-not-ready",
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
    {
      name: "a machine still booting → agent-not-ready (progressing)",
      conditions: [
        { type: "Ready", status: "False", reason: "PodsNotReady" },
        {
          type: "AgentPodReady",
          status: "False",
          reason: "MachineNotReady",
          message: "pulling the image",
        },
      ],
      kind: "agent-not-ready",
      logCause: "wake-timeout:agent-pod-not-ready",
    },
    {
      name: "an unschedulable runner → agent-start-failed, only at the timeout",
      conditions: [
        { type: "Ready", status: "False", reason: "PodsNotReady" },
        {
          type: "AgentPodReady",
          status: "False",
          reason: "MachineRunnerUnschedulable",
          message: "the owner's VM runner cannot be scheduled: 0/3 nodes",
        },
      ],
      kind: "agent-start-failed",
      logCause: "wake-timeout:agent-pod-failed:MachineRunnerUnschedulable",
    },
  ];

  for (const { name, conditions, kind, logCause } of timeoutCases) {
    it(`timeout: ${name}`, async () => {
      const { repo, lines } = harness([agentObj("a1", conditions)]);
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
    const { repo, store } = harness([agentObj("a1", OVER_BUDGET)]);
    const p = repo.ensureReady("a1");
    await vi.advanceTimersByTimeAsync(0);
    store.set("a1", agentObj("a1", READY));
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(p).resolves.toBeUndefined();
  });

  it("fail-fast: a denial that appears during the wake rejects immediately", async () => {
    const { repo, store, lines } = harness([agentObj("a1", HIBERNATED)]);
    const p = repo.ensureReady("a1");
    p.catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
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

  const STORAGE_FULL: Condition[] = [
    { type: "Ready", status: "False", reason: "PodsNotReady" },
    {
      type: "AgentPodReady",
      status: "False",
      reason: "MachineStorageFull",
      message: "the owner's VM storage is full",
    },
  ];

  // TEST_SCENARIO: the runner refuses the machine's start because the owner's VM storage is full. No wait can outgrow that, so a refusal that appears during the wake fails it at once with the cause, not at the two-minute timeout.
  it("fail-fast: a start refusal that appears during the wake rejects immediately", async () => {
    const { repo, store, lines } = harness([agentObj("a1", HIBERNATED)]);
    const p = repo.ensureReady("a1");
    p.catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    store.set("a1", agentObj("a1", STORAGE_FULL));
    await advanceUntilSettled(p);
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(isAgentWakeTimeoutError(err)).toBe(true);
    if (isAgentWakeTimeoutError(err)) {
      expect(err.failure).toEqual({
        kind: "agent-start-failed",
        terminationReason: "MachineStorageFull",
      });
      expect(err.durationMs).toBeLessThan(10_000);
      expect(err.message).toContain("was not started");
    }
    expect(lines.find((l) => l.msg === "agent.wake.rejected")?.cause).toBe(
      "wake-timeout:agent-pod-failed:MachineStorageFull",
    );
  });

  // TEST_SCENARIO: the owner's runner is on a node the cluster has lost. No wait brings that node back, so the wake fails at once with the cause rather than at the two-minute timeout.
  it("fail-fast: a runner on a lost node rejects the wake at once", async () => {
    const NODE_LOST: Condition[] = [
      { type: "Ready", status: "False", reason: "PodsNotReady" },
      {
        type: "AgentPodReady",
        status: "False",
        reason: "MachineRunnerNodeLost",
        message:
          "the owner's VM runner is on node kvm-2, which the cluster does not report ready",
      },
    ];
    const { repo, store, lines } = harness([agentObj("a1", HIBERNATED)]);
    const p = repo.ensureReady("a1");
    p.catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    store.set("a1", agentObj("a1", NODE_LOST));
    await advanceUntilSettled(p);
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(isAgentWakeTimeoutError(err)).toBe(true);
    if (isAgentWakeTimeoutError(err)) {
      expect(err.failure).toEqual({
        kind: "agent-start-failed",
        terminationReason: "MachineRunnerNodeLost",
      });
      expect(err.durationMs).toBeLessThan(10_000);
      expect(err.message).toContain(
        "the server running its owner's agents is down",
      );
    }
    expect(lines.find((l) => l.msg === "agent.wake.rejected")?.cause).toBe(
      "wake-timeout:agent-pod-failed:MachineRunnerNodeLost",
    );
  });

  const CACHE_UNREACHABLE: Condition[] = [
    { type: "Ready", status: "False", reason: "PodsNotReady" },
    {
      type: "AgentPodReady",
      status: "False",
      reason: "MachineImageCacheUnreachable",
      message:
        "the node's image cache service at /var/lib/platform/images/.cache.sock cannot be reached (this runner mounts the node's /var/lib/platform/images as its image cache)",
    },
  ];

  // TEST_SCENARIO: the runner cannot reach the node's image cache, so it boots only the trees its machines already hold and refuses every other image. This wake's own retry is not what brings the machine up — the controller's is — so the wake fails at once with the cause, not at the two-minute timeout.
  it("fail-fast: a start refused for the image cache rejects the wake at once", async () => {
    const { repo, store, lines } = harness([agentObj("a1", HIBERNATED)]);
    const p = repo.ensureReady("a1");
    p.catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    store.set("a1", agentObj("a1", CACHE_UNREACHABLE));
    await advanceUntilSettled(p);
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(isAgentWakeTimeoutError(err)).toBe(true);
    if (isAgentWakeTimeoutError(err)) {
      expect(err.failure).toEqual({
        kind: "agent-start-failed",
        terminationReason: "MachineImageCacheUnreachable",
      });
      expect(err.durationMs).toBeLessThan(10_000);
      expect(err.message).toContain("image cache");
    }
    expect(lines.find((l) => l.msg === "agent.wake.rejected")?.cause).toBe(
      "wake-timeout:agent-pod-failed:MachineImageCacheUnreachable",
    );
  });

  // TEST_SCENARIO: a start the runner's pool has room for but the node has not yet granted memory for is refused by the node's grant, not admitted: it waits for the node's resize, which lands within seconds and needs nothing from the owner. It is not one of the refusals a wake gives up on, so the wake keeps waiting past the grace window and succeeds when the machine boots.
  it("waits out a start waiting for the node rather than failing fast", async () => {
    const { repo, store } = harness([agentObj("a1", AWAITING_ALLOCATION)]);
    const p = repo.ensureReady("a1");
    p.catch(() => {});
    await vi.advanceTimersByTimeAsync(30_000);
    store.set("a1", agentObj("a1", READY));
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(p).resolves.toBeUndefined();
  });

  // TEST_SCENARIO: a start held back by the machines a runner restart is still bringing back is a wait, not a refusal: the pool it does not fit in counts those machines at their warm-up floors and settles below it once they have warmed, so the wake keeps waiting past the grace window and succeeds when the machine boots.
  it("waits out a start held back by its owner's warm-up rather than failing fast", async () => {
    const { repo, store } = harness([agentObj("a1", AWAITING_WARM_UP)]);
    const p = repo.ensureReady("a1");
    p.catch(() => {});
    await vi.advanceTimersByTimeAsync(30_000);
    store.set("a1", agentObj("a1", READY));
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(p).resolves.toBeUndefined();
  });

  // TEST_SCENARIO: an awake agent already in error with a refused start. The first polls may read the previous attempt's refusal, so the wake waits out the short grace, then fails well before its timeout.
  it("fail-fast: a standing start refusal outlasting the grace window rejects", async () => {
    const { repo } = harness([agentObj("a1", STORAGE_FULL)]);
    const p = repo.ensureReady("a1");
    p.catch(() => {});
    await advanceUntilSettled(p);
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(isAgentWakeTimeoutError(err)).toBe(true);
    if (isAgentWakeTimeoutError(err)) {
      expect(err.failure.kind).toBe("agent-start-failed");
      expect(err.durationMs).toBeGreaterThanOrEqual(10_000);
      expect(err.durationMs).toBeLessThan(120_000);
    }
  });

  const UNREADABLE_GRANT: Condition[] = [
    {
      type: "Ready",
      status: "False",
      reason: "MachineAllocationUnreadable",
      message:
        "The node has not reported how much memory it granted this owner's VM runner, so this start can't be admitted yet. The platform keeps retrying every 30 seconds; if this lasts, an admin should check that the cluster can resize pods in place.",
    },
    {
      type: "AgentPodReady",
      status: "False",
      reason: "MachineAllocationUnreadable",
      message:
        "The node has not reported how much memory it granted this owner's VM runner, so this start can't be admitted yet. The platform keeps retrying every 30 seconds; if this lasts, an admin should check that the cluster can resize pods in place.",
    },
  ];

  // TEST_SCENARIO: the node has gone a minute without reporting what it granted the runner, and the controller has published that as the start's own diagnosis. No wait of this wake's brings the machine up, so the wake fails at once with the cause the page and the channel copy already name, not at the two-minute timeout.
  it("fail-fast: a standing unreadable-grant hold rejects at once", async () => {
    const { repo, lines } = harness([agentObj("a1", UNREADABLE_GRANT)]);
    const p = repo.ensureReady("a1");
    p.catch(() => {});
    await advanceUntilSettled(p);
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(isAgentWakeTimeoutError(err)).toBe(true);
    if (isAgentWakeTimeoutError(err)) {
      expect(err.failure).toEqual({
        kind: "agent-start-failed",
        terminationReason: "MachineAllocationUnreadable",
      });
      expect(err.durationMs).toBeLessThan(30_000);
    }
    expect(lines.find((l) => l.msg === "agent.wake.rejected")?.cause).toBe(
      "wake-timeout:agent-pod-failed:MachineAllocationUnreadable",
    );
  });

  // TEST_SCENARIO: the refusal the wake first reads is the previous attempt's; the owner freed storage, and the controller's retry boots the machine within the grace. The wake must ride the stale refusal through and succeed.
  it("keeps polling past a stale start refusal and succeeds once the machine boots", async () => {
    const { repo, store } = harness([agentObj("a1", STORAGE_FULL)]);
    const p = repo.ensureReady("a1");
    await vi.advanceTimersByTimeAsync(0);
    store.set("a1", agentObj("a1", READY));
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(p).resolves.toBeUndefined();
  });

  // TEST_SCENARIO: a hibernated agent keeps the refusal of the start before it slept. Until the controller acts on the wake, that refusal is not this wake's, so the wake keeps waiting.
  it("ignores a start refusal while the agent still reads hibernated", async () => {
    const { repo, store } = harness([
      agentObj("a1", [...HIBERNATED, STORAGE_FULL[1]!]),
    ]);
    const p = repo.ensureReady("a1");
    p.catch(() => {});
    await vi.advanceTimersByTimeAsync(30_000);
    store.set("a1", agentObj("a1", READY));
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(p).resolves.toBeUndefined();
  });
  it("a stop landing mid-wake fails fast and is never cleared by the wake", async () => {
    const { repo, store } = harness([agentObj("a1", HIBERNATED)]);
    const p = repo.ensureReady("a1");
    p.catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    const obj = store.get("a1");
    obj!.metadata!.annotations!["agent-platform.ai/stop-requested"] =
      "2026-07-14T00:00:00Z";
    await advanceUntilSettled(p);
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(isAgentStoppedError(err)).toBe(true);
    expect(
      store.get("a1")?.metadata?.annotations?.[
        "agent-platform.ai/stop-requested"
      ],
    ).toBe("2026-07-14T00:00:00Z");
  });

  it("late ready at the deadline counts as success", async () => {
    const { store, lines } = harness([agentObj("a1", HIBERNATED)]);
    const original = store.get("a1")!;
    let polls = 0;
    const { client } = (() => {
      const inner = fakeK8s([original]);
      const wrapped: K8sClient = {
        ...inner.client,
        async getCustomObject(plural, name) {
          polls++;
          if (Date.now() >= 120_000) {
            return agentObj("a1", READY);
          }
          return inner.client.getCustomObject(plural, name);
        },
      };
      return { client: wrapped };
    })();
    vi.setSystemTime(0);
    const repo2 = createAgentsRepository(
      client,
      createLiveAgentStateCache(client),
    );
    const p = repo2.ensureReady("a1");
    await advanceUntilSettled(p);
    await expect(p).resolves.toBeUndefined();
    expect(polls).toBeGreaterThan(1);
    expect(lines.find((l) => l.msg === "agent.wake.ready")?.lateReady).toBe(
      true,
    );
  });
});

const PIN_KEY = "agent-platform.ai/invocations-active";

describe("requestStop", () => {
  it("clears the Invocation Pin", async () => {
    const { repo, store } = harness([agentObj("a1", READY)]);
    store.get("a1")!.metadata!.annotations![PIN_KEY] = "true";
    await repo.requestStop("a1");
    expect(store.get("a1")?.metadata?.annotations?.[PIN_KEY]).toBe("");
  });
});

describe("releaseInvocationPin", () => {
  const ACTIVITY_KEY = "agent-platform.ai/last-activity";

  function pinnedHarness(pin: string) {
    const obj = agentObj("a1", READY);
    obj.metadata!.annotations![PIN_KEY] = pin;
    obj.metadata!.annotations![ACTIVITY_KEY] = "1970-01-01T00:00:00Z";
    (obj.metadata as { resourceVersion?: string }).resourceVersion = "7";
    const { client, store } = fakeK8s([obj]);
    const patches: unknown[] = [];
    const recording: K8sClient = {
      ...client,
      async patchCustomObject(plural, name, body) {
        patches.push(body);
        return client.patchCustomObject(plural, name, body);
      },
    };
    const repo = createAgentsRepository(
      recording,
      createLiveAgentStateCache(recording),
    );
    return { repo, store, patches };
  }

  // TEST_SCENARIO: the reconcile reads a pinned Driver's version before it checks the Driver's Invocations, so the release can be conditional on that read.
  it("reads the version of a pinned Driver", async () => {
    const { repo } = pinnedHarness("true");

    expect(await repo.readInvocationPin("a1")).toBe("7");
  });

  // TEST_SCENARIO: a sleep cleared the pin after the reconcile listed this Driver from the cache; the read reports it unpinned so its stale clock is left alone.
  it("reads no version once the pin is gone", async () => {
    const { repo, patches } = pinnedHarness("");

    expect(await repo.readInvocationPin("a1")).toBeNull();
    expect(patches).toEqual([]);
  });

  // TEST_SCENARIO: the release bumps the Driver's activity and drops its pin in one write that is conditional on the version the reconcile read, so a pause or spawn landing in between makes the write fail.
  it("clears the pin and bumps activity in one conditional write", async () => {
    const { repo, store, patches } = pinnedHarness("true");

    await repo.releaseInvocationPin("a1", "7");

    const ann = store.get("a1")?.metadata?.annotations ?? {};
    expect(ann[PIN_KEY]).toBe("");
    expect(ann[ACTIVITY_KEY]).not.toBe("1970-01-01T00:00:00Z");
    expect(patches).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({ resourceVersion: "7" }),
      }),
    ]);
  });
});

describe("setInvocationPin", () => {
  const STOP_KEY = "agent-platform.ai/stop-requested";

  function recordingHarness(stop: string) {
    const obj = agentObj("a1", READY);
    obj.metadata!.annotations![STOP_KEY] = stop;
    (obj.metadata as { resourceVersion?: string }).resourceVersion = "7";
    const { client, store } = fakeK8s([obj]);
    const patches: unknown[] = [];
    const recording: K8sClient = {
      ...client,
      async patchCustomObject(plural, name, body) {
        patches.push(body);
        return client.patchCustomObject(plural, name, body);
      },
    };
    const repo = createAgentsRepository(
      recording,
      createLiveAgentStateCache(recording),
    );
    return { repo, store, patches };
  }

  // TEST_SCENARIO: a spawn pins its Driver with a write conditional on the object it read, so a sleep landing in between makes the write fail rather than pin a paused Driver.
  it("pins a running Driver in one conditional write", async () => {
    const { repo, store, patches } = recordingHarness("");

    expect(await repo.setInvocationPin("a1")).toBe(true);

    expect(store.get("a1")?.metadata?.annotations?.[PIN_KEY]).toBe("true");
    expect(patches).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({ resourceVersion: "7" }),
      }),
    ]);
  });

  // TEST_SCENARIO: a Driver spawns inside the settle window of a sleep; the pin would revive it once the sleep settles, so the spawn leaves it unpinned.
  it("writes nothing while a sleep stands", async () => {
    const { repo, store, patches } = recordingHarness(
      "2026-09-28T09:00:00.000Z",
    );

    expect(await repo.setInvocationPin("a1")).toBe(false);

    expect(patches).toEqual([]);
    expect(store.get("a1")?.metadata?.annotations?.[PIN_KEY]).toBeUndefined();
  });

  // TEST_SCENARIO: a sibling spawn pinned the Driver first; this spawn still writes, because the reconcile's release is conditional on the Driver's version and only a write makes a spawn landing in between fail it.
  it("writes the pin again when the Driver is already pinned", async () => {
    const { repo, store, patches } = recordingHarness("");
    store.get("a1")!.metadata!.annotations![PIN_KEY] = "true";

    expect(await repo.setInvocationPin("a1")).toBe(true);

    expect(patches).toHaveLength(1);
  });

  function conflicting(times: number) {
    const obj = agentObj("a1", READY);
    (obj.metadata as { resourceVersion?: string }).resourceVersion = "7";
    const { client, store } = fakeK8s([obj]);
    let left = times;
    const patches: unknown[] = [];
    const racing: K8sClient = {
      ...client,
      async patchCustomObject(plural, name, body) {
        patches.push(body);
        if (left-- > 0) {
          throw Object.assign(new Error("409 Conflict"), { code: 409 });
        }
        return client.patchCustomObject(plural, name, body);
      },
    };
    const repo = createAgentsRepository(
      racing,
      createLiveAgentStateCache(racing),
    );
    return { repo, store, patches };
  }

  // TEST_SCENARIO: the Driver changed between the read and the write, by a controller status update or a sibling's pin; the spawn reads it again and writes again instead of failing.
  it("reads again and retries a write that lost to a concurrent change", async () => {
    const { repo, store, patches } = conflicting(2);

    expect(await repo.setInvocationPin("a1")).toBe(true);

    expect(patches).toHaveLength(3);
    expect(store.get("a1")?.metadata?.annotations?.[PIN_KEY]).toBe("true");
  });

  // TEST_SCENARIO: a Driver that keeps changing under the write is not pinned silently; the spawn fails so it leaves no Invocation behind.
  it("fails once the write keeps losing", async () => {
    const { repo, patches } = conflicting(99);

    await expect(repo.setInvocationPin("a1")).rejects.toThrow("409");

    expect(patches).toHaveLength(5);
  });
});

describe("ensureReady waitOnly", () => {
  const STARTING: Condition[] = [
    { type: "Ready", status: "False", reason: "PodsNotReady" },
  ];
  const activity = (store: Map<string, KubeObject>) =>
    store.get("a1")?.metadata?.annotations?.["agent-platform.ai/last-activity"];

  // TEST_SCENARIO: the tRPC relay waits this way on a reconnect from an open tab, so a new activity stamp would read as a new wake and keep an idle agent up.
  it("waits for a starting agent without stamping activity", async () => {
    const { repo, store } = harness([agentObj("a1", STARTING)]);
    const p = repo.ensureReady("a1", { waitOnly: true });
    await vi.advanceTimersByTimeAsync(5_000);
    store.set("a1", agentObj("a1", READY));
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(p).resolves.toBeUndefined();
    expect(activity(store)).toBeUndefined();
  });

  it("stamps nothing on a ready agent", async () => {
    const { repo, store } = harness([agentObj("a1", READY)]);
    await repo.ensureReady("a1", { waitOnly: true });
    expect(activity(store)).toBeUndefined();
  });

  it("gives up at once when the agent settles hibernated with no wake asked for", async () => {
    const { repo, store } = harness([agentObj("a1", STARTING)]);
    const p = repo.ensureReady("a1", { waitOnly: true });
    p.catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    store.set("a1", agentObj("a1", HIBERNATED));
    await vi.advanceTimersByTimeAsync(5_000);
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(isAgentWakeTimeoutError(err)).toBe(true);
    if (isAgentWakeTimeoutError(err)) {
      expect(err.failure.kind).toBe("hibernated-not-scaled");
      expect(err.durationMs).toBeLessThan(120_000);
    }
    expect(activity(store)).toBeUndefined();
  });
});
describe("requestSleep settle", () => {
  const STOP_KEY = "agent-platform.ai/stop-requested";

  it("clears its own stop once the controller reports Hibernated", async () => {
    const { repo, store } = harness([agentObj("a1", READY)]);
    const infra = await repo.requestSleep("a1");
    expect(infra).not.toBeNull();
    const ann = () => store.get("a1")?.metadata?.annotations ?? {};
    expect(ann()[STOP_KEY]).toBeTruthy();
    (store.get("a1") as { status?: unknown }).status = {
      conditions: HIBERNATED,
    };
    await vi.advanceTimersByTimeAsync(5_000);
    expect(ann()[STOP_KEY]).toBe("");
  });

  // TEST_SCENARIO: a sleep must win over running sub-agents; it clears the Invocation Pin along with the session pin, so nothing restarts the Driver once the sleep settles.
  it("clears the Invocation Pin", async () => {
    const { repo, store } = harness([agentObj("a1", READY)]);
    store.get("a1")!.metadata!.annotations![PIN_KEY] = "true";
    await repo.requestSleep("a1");
    expect(store.get("a1")?.metadata?.annotations?.[PIN_KEY]).toBe("");
  });

  // TEST_SCENARIO: a sleep stales last activity behind any reclaim mark an earlier reclaim left, which would make the agent read as put to sleep automatically to free memory. The user put it to sleep, so the sleep removes the mark.
  it("removes an earlier reclaim mark", async () => {
    const { repo, store } = harness([agentObj("a1", READY)]);
    store.get("a1")!.metadata!.annotations!["agent-platform.ai/reclaimed-at"] =
      "2026-10-14T23:39:22Z";
    await repo.requestSleep("a1");
    expect(
      store.get("a1")?.metadata?.annotations?.[
        "agent-platform.ai/reclaimed-at"
      ],
    ).toBe("");
  });

  it("leaves a stop stamped during the settle window in place", async () => {
    const { repo, store } = harness([agentObj("a1", READY)]);
    await repo.requestSleep("a1");
    const obj = store.get("a1");
    obj!.metadata!.annotations![STOP_KEY] = "9999-01-01T00:00:00Z";
    (obj as { status?: unknown }).status = { conditions: HIBERNATED };
    await vi.advanceTimersByTimeAsync(65_000);
    expect(store.get("a1")?.metadata?.annotations?.[STOP_KEY]).toBe(
      "9999-01-01T00:00:00Z",
    );
  });
});
