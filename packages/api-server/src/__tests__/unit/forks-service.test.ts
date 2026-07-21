import { describe, it, expect } from "vitest";
import { EventType, type DomainEvent } from "../../events.js";
import { createForksService } from "../../modules/forks/services/forks-service.js";
import type { ForkStatus } from "../../modules/forks/domain/fork.js";
import type { ForkOrchestratorPort } from "../../modules/forks/infrastructure/ports.js";
import { err, ok } from "../../core/result.js";

async function* statusesOf(items: ForkStatus[]): AsyncGenerator<ForkStatus> {
  for (const item of items) yield item;
}

function makeHarness(args?: {
  /** What getFork resolves — the CR the ensure finds (null = none). */
  existing?: { status: ForkStatus | null } | null;
  /** Status sequence the watch yields after the ensure settles the CR. */
  statuses?: ForkStatus[];
  orchestrator?: Partial<ForkOrchestratorPort>;
}) {
  const events: DomainEvent[] = [];
  const calls = {
    createdForks: [] as string[],
    deletedForks: [] as string[],
    bumpedForks: [] as string[],
    credRevBumps: [] as string[],
  };

  const orchestrator: ForkOrchestratorPort = {
    createFork: async ({ forkId }) => {
      calls.createdForks.push(forkId);
      return ok(undefined);
    },
    getFork: async () =>
      args?.existing
        ? { agentId: "inst-1", foreignSub: "kc|user-42", ...args.existing }
        : null,
    bumpActivity: async (forkId) => {
      calls.bumpedForks.push(forkId);
    },
    watchStatus: () => statusesOf(args?.statuses ?? []),
    deleteFork: async (forkId) => {
      calls.deletedForks.push(forkId);
    },
    bumpCredentialsRev: async (forkId) => {
      calls.credRevBumps.push(forkId);
    },
    listForks: async () => [],
    ...args?.orchestrator,
  };

  const service = createForksService({
    orchestrator,
    forkIdFor: () => "fork-1",
    emit: (e) => events.push(e),
  });

  return { events, calls, service };
}

const input = {
  agentId: "inst-1",
  foreignSub: "kc|user-42",
  replyId: "reply-1",
};

describe("ForksService.ensureFork", () => {
  it("creates the CR on first contact, bumps activity, and emits ForkReady", async () => {
    const h = makeHarness({
      statuses: [{ phase: "Pending" }, { phase: "Ready", podIP: "10.0.0.5" }],
    });
    await h.service.ensureFork(input);

    expect(h.calls.createdForks).toEqual(["fork-1"]);
    expect(h.calls.bumpedForks).toEqual(["fork-1"]);
    expect(h.events).toEqual([
      {
        type: EventType.ForkReady,
        forkId: "fork-1",
        replyId: "reply-1",
        podIP: "10.0.0.5",
      },
    ]);
  });

  it("reuses a live fork without recreating it", async () => {
    const h = makeHarness({
      existing: { status: { phase: "Ready", podIP: "10.0.0.5" } },
      statuses: [{ phase: "Ready", podIP: "10.0.0.5" }],
    });
    await h.service.ensureFork(input);

    expect(h.calls.createdForks).toEqual([]);
    expect(h.calls.deletedForks).toEqual([]);
    expect(h.calls.bumpedForks).toEqual(["fork-1"]);
    expect(h.events).toEqual([
      {
        type: EventType.ForkReady,
        forkId: "fork-1",
        replyId: "reply-1",
        podIP: "10.0.0.5",
      },
    ]);
  });

  it("wakes a hibernated fork — the bump is the wake poke", async () => {
    const h = makeHarness({
      existing: { status: { phase: "Hibernated" } },
      statuses: [
        { phase: "Hibernated" },
        { phase: "Pending" },
        { phase: "Ready", podIP: "10.0.0.7" },
      ],
    });
    await h.service.ensureFork(input);

    expect(h.calls.createdForks).toEqual([]);
    expect(h.calls.bumpedForks).toEqual(["fork-1"]);
    expect(h.events).toEqual([
      {
        type: EventType.ForkReady,
        forkId: "fork-1",
        replyId: "reply-1",
        podIP: "10.0.0.7",
      },
    ]);
  });

  it("clears a defunct fork and rebuilds the slot", async () => {
    const h = makeHarness({
      existing: {
        status: { phase: "Failed", error: { reason: "Timeout" } },
      },
      statuses: [{ phase: "Ready", podIP: "10.0.0.9" }],
    });
    await h.service.ensureFork(input);

    expect(h.calls.deletedForks).toEqual(["fork-1"]);
    expect(h.calls.createdForks).toEqual(["fork-1"]);
    expect(h.events).toEqual([
      {
        type: EventType.ForkReady,
        forkId: "fork-1",
        replyId: "reply-1",
        podIP: "10.0.0.9",
      },
    ]);
  });

  it("treats AlreadyExists as a concurrent ensure winning the create", async () => {
    const h = makeHarness({
      statuses: [{ phase: "Ready", podIP: "10.0.0.5" }],
      orchestrator: {
        createFork: async () => err({ kind: "AlreadyExists" }),
      },
    });
    await h.service.ensureFork(input);

    expect(h.events).toEqual([
      {
        type: EventType.ForkReady,
        forkId: "fork-1",
        replyId: "reply-1",
        podIP: "10.0.0.5",
      },
    ]);
  });

  it("emits ForkFailed(OrchestrationFailed) when createFork write-fails", async () => {
    const h = makeHarness({
      orchestrator: {
        createFork: async () =>
          err({ kind: "WriteFailed", detail: "apiserver 503" }),
      },
    });
    await h.service.ensureFork(input);

    expect(h.events).toEqual([
      {
        type: EventType.ForkFailed,
        forkId: "fork-1",
        replyId: "reply-1",
        reason: "OrchestrationFailed",
        detail: "apiserver 503",
      },
    ]);
  });

  it("maps a Failed watch status into ForkFailed and leaves the CR for the next ensure", async () => {
    const h = makeHarness({
      statuses: [
        {
          phase: "Failed",
          error: { reason: "PodNotReady", detail: "CrashLoopBackOff" },
        },
      ],
    });
    await h.service.ensureFork(input);

    expect(h.events).toEqual([
      {
        type: EventType.ForkFailed,
        forkId: "fork-1",
        replyId: "reply-1",
        reason: "PodNotReady",
        detail: "CrashLoopBackOff",
      },
    ]);
    // The controller already tore the failed fork's pods down; the CR stays
    // as the visible failure record until the next ensure rebuilds the slot.
    expect(h.calls.deletedForks).toEqual([]);
  });

  it("emits ForkFailed when the CR vanishes mid-watch", async () => {
    const h = makeHarness({ statuses: [{ phase: "Pending" }] });
    await h.service.ensureFork(input);

    expect(h.events).toEqual([
      {
        type: EventType.ForkFailed,
        forkId: "fork-1",
        replyId: "reply-1",
        reason: "OrchestrationFailed",
        detail: "fork disappeared while starting",
      },
    ]);
  });

  it("emits ForkFailed when the activity bump errors", async () => {
    const h = makeHarness({
      orchestrator: {
        bumpActivity: async () => {
          throw new Error("apiserver 503");
        },
      },
    });
    await h.service.ensureFork(input);

    expect(h.events).toEqual([
      {
        type: EventType.ForkFailed,
        forkId: "fork-1",
        replyId: "reply-1",
        reason: "OrchestrationFailed",
        detail: "Error: apiserver 503",
      },
    ]);
  });

  it("emits ForkFailed on an empty foreignSub instead of throwing into the saga", async () => {
    const h = makeHarness({});
    await h.service.ensureFork({ ...input, foreignSub: "" });

    expect(h.events).toHaveLength(1);
    expect(h.events[0]).toMatchObject({
      type: EventType.ForkFailed,
      replyId: "reply-1",
      reason: "OrchestrationFailed",
    });
  });
});

describe("ForksService.recordActivity", () => {
  it("stamps the fork's activity annotation", async () => {
    const h = makeHarness({});
    await h.service.recordActivity("fork-9");
    expect(h.calls.bumpedForks).toEqual(["fork-9"]);
  });
});

describe("ForksService.endFork", () => {
  it("deletes the fork and emits ForkCompleted", async () => {
    const h = makeHarness({});
    await h.service.endFork("fork-1");

    expect(h.calls.deletedForks).toEqual(["fork-1"]);
    expect(h.events).toEqual([
      { type: EventType.ForkCompleted, forkId: "fork-1" },
    ]);
  });
});

describe("ForksService.resolveIdentity", () => {
  it("maps the fork CR into the acting context", async () => {
    const h = makeHarness({
      existing: { status: { phase: "Ready", podIP: "10.0.0.5" } },
    });
    expect(await h.service.resolveIdentity("fork-1")).toEqual({
      forkId: "fork-1",
      parentAgentId: "inst-1",
      foreignSub: "kc|user-42",
      podIP: "10.0.0.5",
    });
  });

  it("reports a null podIP for a hibernated fork", async () => {
    const h = makeHarness({ existing: { status: { phase: "Hibernated" } } });
    expect(await h.service.resolveIdentity("fork-1")).toMatchObject({
      podIP: null,
    });
  });

  it("returns null for an unknown fork", async () => {
    const h = makeHarness({});
    expect(await h.service.resolveIdentity("fork-1")).toBeNull();
  });
});
