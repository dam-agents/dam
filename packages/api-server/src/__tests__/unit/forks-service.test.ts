import { describe, it, expect } from "vitest";
import { EventType, type DomainEvent } from "../../events.js";
import { createForksService } from "../../modules/forks/services/forks-service.js";
import type { ForkStatus } from "../../modules/forks/domain/fork.js";
import type { ForkOrchestratorPort } from "../../modules/forks/infrastructure/ports.js";
import { err, ok } from "../../core/result.js";

type Harness = {
  events: DomainEvent[];
  emit: (e: DomainEvent) => void;
  statusStream: (forkId: string, items: ForkStatus[]) => void;
  streamDone: () => Promise<void>;
};

function makeHarness(overrides: {
  orchestrator?: Partial<ForkOrchestratorPort>;
}): Harness & {
  service: ReturnType<typeof createForksService>;
  calls: { createdForks: string[]; deletedForks: string[] };
} {
  const events: DomainEvent[] = [];
  const calls = { createdForks: [] as string[], deletedForks: [] as string[] };
  const streams = new Map<
    string,
    {
      push: (s: ForkStatus) => void;
      close: () => void;
      iterable: AsyncIterable<ForkStatus>;
    }
  >();

  function makeStream(forkId: string): AsyncIterable<ForkStatus> {
    const queue: ForkStatus[] = [];
    const resolvers: Array<(v: IteratorResult<ForkStatus>) => void> = [];
    let closed = false;
    const push = (s: ForkStatus) => {
      const r = resolvers.shift();
      if (r) r({ value: s, done: false });
      else queue.push(s);
    };
    const close = () => {
      closed = true;
      const r = resolvers.shift();
      if (r) r({ value: undefined as unknown as ForkStatus, done: true });
    };
    const iterable: AsyncIterable<ForkStatus> = {
      [Symbol.asyncIterator]: () => ({
        next: () =>
          new Promise<IteratorResult<ForkStatus>>((resolve) => {
            const s = queue.shift();
            if (s) resolve({ value: s, done: false });
            else if (closed)
              resolve({
                value: undefined as unknown as ForkStatus,
                done: true,
              });
            else resolvers.push(resolve);
          }),
      }),
    };
    streams.set(forkId, { push, close, iterable });
    return iterable;
  }

  const orchestrator: ForkOrchestratorPort = {
    createFork: async ({ forkId }) => {
      calls.createdForks.push(forkId);
      return ok(undefined);
    },
    watchStatus: (forkId) => makeStream(forkId),
    deleteFork: async (forkId) => {
      calls.deletedForks.push(forkId);
    },
    ...overrides.orchestrator,
  };

  const service = createForksService({
    orchestrator,
    emit: (e) => events.push(e),
    generateForkId: (() => {
      let n = 0;
      return () => `fork-${++n}`;
    })(),
  });

  return {
    events,
    emit: (e) => events.push(e),
    service,
    calls,
    statusStream: (forkId, items) => {
      const s = streams.get(forkId);
      if (!s) throw new Error(`no stream for ${forkId}`);
      for (const item of items) s.push(item);
      s.close();
    },
    streamDone: async () => {
      await new Promise((r) => setTimeout(r, 10));
    },
  };
}

describe("ForksService.openFork", () => {
  it("emits ForkReady with replyId + podIP when the orchestrator reports Ready", async () => {
    const h = makeHarness({});
    await h.service.openFork({
      agentId: "inst-1",
      foreignSub: "kc|user-42",
      replyId: "reply-1",
    });
    h.statusStream("fork-1", [{ phase: "Ready", podIP: "10.0.0.5" }]);
    await h.streamDone();

    expect(h.calls.createdForks).toEqual(["fork-1"]);
    expect(h.events).toEqual([
      {
        type: EventType.ForkReady,
        forkId: "fork-1",
        replyId: "reply-1",
        podIP: "10.0.0.5",
      },
    ]);
  });

  it("emits ForkFailed(OrchestrationFailed) when orchestrator.createFork errors", async () => {
    const h = makeHarness({
      orchestrator: {
        createFork: async () =>
          err({ kind: "WriteFailed", detail: "apiserver 503" }),
      },
    });
    await h.service.openFork({
      agentId: "inst-1",
      foreignSub: "kc|user-42",
      replyId: "reply-1",
    });

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

  it("maps orchestrator status.Failed into ForkFailed carrying the reason", async () => {
    const h = makeHarness({});
    await h.service.openFork({
      agentId: "inst-1",
      foreignSub: "kc|user-42",
      replyId: "reply-1",
    });
    h.statusStream("fork-1", [
      {
        phase: "Failed",
        error: { reason: "PodNotReady", detail: "CrashLoopBackOff" },
      },
    ]);
    await h.streamDone();

    expect(h.events).toEqual([
      {
        type: EventType.ForkFailed,
        forkId: "fork-1",
        replyId: "reply-1",
        reason: "PodNotReady",
        detail: "CrashLoopBackOff",
      },
    ]);
  });

  it("deletes the K8s fork state when the orchestrator reports Failed", async () => {
    const h = makeHarness({});
    await h.service.openFork({
      agentId: "inst-1",
      foreignSub: "kc|user-42",
      replyId: "reply-1",
    });
    h.statusStream("fork-1", [
      {
        phase: "Failed",
        error: { reason: "PodNotReady", detail: "CrashLoopBackOff" },
      },
    ]);
    await h.streamDone();

    // The gateway pod is owner-refed to the Fork CR; without this delete a
    // failed fork's crash-looping gateway would outlive the turn forever.
    expect(h.calls.deletedForks).toEqual(["fork-1"]);
    // A later ChannelTurnRelayed-driven closeFork must not re-emit anything.
    await h.service.closeFork("fork-1");
    expect(h.events.filter((e) => e.type === EventType.ForkCompleted)).toEqual(
      [],
    );
  });

  it("deletes the K8s fork state when createFork errors", async () => {
    const h = makeHarness({
      orchestrator: {
        createFork: async () =>
          err({ kind: "WriteFailed", detail: "apiserver 503" }),
      },
    });
    await h.service.openFork({
      agentId: "inst-1",
      foreignSub: "kc|user-42",
      replyId: "reply-1",
    });

    expect(h.calls.deletedForks).toEqual(["fork-1"]);
  });

  it("still emits ForkFailed when the failure-path delete throws", async () => {
    const h = makeHarness({
      orchestrator: {
        deleteFork: async () => {
          throw new Error("apiserver 503");
        },
      },
    });
    await h.service.openFork({
      agentId: "inst-1",
      foreignSub: "kc|user-42",
      replyId: "reply-1",
    });
    h.statusStream("fork-1", [
      { phase: "Failed", error: { reason: "Timeout" } },
    ]);
    await h.streamDone();

    expect(h.events).toEqual([
      {
        type: EventType.ForkFailed,
        forkId: "fork-1",
        replyId: "reply-1",
        reason: "Timeout",
      },
    ]);
  });

  it("rejects empty foreignSub", async () => {
    const h = makeHarness({});
    await expect(
      h.service.openFork({
        agentId: "inst-1",
        foreignSub: "",
        replyId: "reply-1",
      }),
    ).rejects.toThrow();
  });
});

describe("ForksService.closeFork", () => {
  it("deletes the K8s fork and emits ForkCompleted after a Ready fork", async () => {
    const h = makeHarness({});
    await h.service.openFork({
      agentId: "inst-1",
      foreignSub: "kc|user-42",
      replyId: "reply-1",
    });
    h.statusStream("fork-1", [{ phase: "Ready", podIP: "10.0.0.5" }]);
    await h.streamDone();
    h.events.length = 0;

    await h.service.closeFork("fork-1");

    expect(h.calls.deletedForks).toEqual(["fork-1"]);
    expect(h.events).toEqual([
      { type: EventType.ForkCompleted, forkId: "fork-1" },
    ]);
  });

  it("is a no-op for unknown forkIds", async () => {
    const h = makeHarness({});
    await h.service.closeFork("unknown");
    expect(h.calls.deletedForks).toEqual([]);
    expect(h.events).toEqual([]);
  });
});
