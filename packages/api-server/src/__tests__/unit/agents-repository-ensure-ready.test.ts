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

  // TEST_SCENARIO: while an agent moves to the new runtime the controller holds it down until the copy has booted, so waiting for it would only run out the wake timeout. The wake refuses at once with a cause callers turn into "try again in a few minutes", and it does not poke the agent awake.
  it("refuses at once while the agent is moving to the new runtime", async () => {
    const obj = agentObj("a1", HIBERNATED);
    obj.metadata!.annotations!["agent-platform.ai/runtime-migration"] =
      "copying";
    const { repo, store } = harness([obj]);
    const err = await repo.ensureReady("a1").then(
      () => null,
      (e: unknown) => e,
    );
    expect(isAgentWakeTimeoutError(err) && err.failure).toEqual({
      kind: "migrating",
    });
    expect(
      store.get("a1")?.metadata?.annotations?.[
        "agent-platform.ai/last-activity"
      ],
    ).toBeUndefined();
  });

  // TEST_SCENARIO: a migration that failed after it stopped the container keeps it stopped until the owner retries or aborts, so the wake is refused at once with a cause that says the move failed.
  it("refuses at once while a failed migration keeps the agent stopped", async () => {
    const obj = agentObj("a1", [
      ...HIBERNATED,
      { type: "RuntimeMigrating", status: "False", reason: "Failed" },
    ]);
    obj.metadata!.annotations!["agent-platform.ai/runtime-migration"] =
      "requested";
    obj.metadata!.annotations!["agent-platform.ai/runtime-migration-source"] =
      "{}";
    const { repo } = harness([obj]);
    const err = await repo.ensureReady("a1").then(
      () => null,
      (e: unknown) => e,
    );
    expect(isAgentWakeTimeoutError(err) && err.failure).toEqual({
      kind: "migration-failed",
    });
  });

  // TEST_SCENARIO: through the preflight the container keeps running, so a wake for it is served as usual.
  it("serves a wake during the preflight", async () => {
    const obj = agentObj("a1", [
      ...READY,
      { type: "RuntimeMigrating", status: "True", reason: "Requested" },
    ]);
    obj.metadata!.annotations!["agent-platform.ai/runtime-migration"] =
      "requested";
    const { repo } = harness([obj]);
    await expect(repo.ensureReady("a1")).resolves.toBeUndefined();
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

  // TEST_SCENARIO: the release bumps the Driver's activity and drops its pin in one write that is conditional on the object it read, so a pause landing in between makes the write fail rather than revive the Driver.
  it("clears a held pin and bumps activity in one conditional write", async () => {
    const { repo, store, patches } = pinnedHarness("true");

    expect(await repo.releaseInvocationPin("a1")).toBe(true);

    const ann = store.get("a1")?.metadata?.annotations ?? {};
    expect(ann[PIN_KEY]).toBe("");
    expect(ann[ACTIVITY_KEY]).not.toBe("1970-01-01T00:00:00Z");
    expect(patches).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({ resourceVersion: "7" }),
      }),
    ]);
  });

  // TEST_SCENARIO: a pause cleared the pin and staled the clock after the reconcile listed this Driver; the release must leave that stale clock alone.
  it("writes nothing once the pin is gone", async () => {
    const { repo, store, patches } = pinnedHarness("");

    expect(await repo.releaseInvocationPin("a1")).toBe(false);

    expect(patches).toEqual([]);
    expect(store.get("a1")?.metadata?.annotations?.[ACTIVITY_KEY]).toBe(
      "1970-01-01T00:00:00Z",
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
    (store.get("a1") as { status?: unknown }).status = {
      conditions: HIBERNATED,
    };
    await vi.advanceTimersByTimeAsync(5_000);
    expect(ann()[STOP_KEY]).toBe("");
  });

  // TEST_SCENARIO: a pause must win over running sub-agents; it clears the Invocation Pin along with the session pin, so nothing restarts the Driver once the pause settles.
  it("clears the Invocation Pin", async () => {
    const { repo, store } = harness([agentObj("a1", READY)]);
    store.get("a1")!.metadata!.annotations![PIN_KEY] = "true";
    await repo.requestPause("a1");
    expect(store.get("a1")?.metadata?.annotations?.[PIN_KEY]).toBe("");
  });

  it("leaves a stop stamped during the settle window in place", async () => {
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
