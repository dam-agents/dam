import { describe, it, expect } from "vitest";
import { EventType, type DomainEvent } from "../../events.js";
import { createForksService } from "../../modules/forks/services/forks-service.js";
import type { ForkStatus } from "../../modules/forks/domain/fork.js";
import type {
  ForeignCredentialsPort,
  ForkOrchestratorPort,
} from "../../modules/forks/infrastructure/ports.js";
import { err, ok } from "../../core/result.js";

type Harness = {
  events: DomainEvent[];
  emit: (e: DomainEvent) => void;
  statusStream: (forkId: string, items: ForkStatus[]) => void;
  streamDone: () => Promise<void>;
};

function makeHarness(overrides: {
  foreignCredentials?: Partial<ForeignCredentialsPort>;
  orchestrator?: Partial<ForkOrchestratorPort>;
}): Harness & {
  service: ReturnType<typeof createForksService>;
  calls: { createdForks: string[]; deletedForks: string[] };
} {
  const events: DomainEvent[] = [];
  const calls = { createdForks: [] as string[], deletedForks: [] as string[] };
  const streams = new Map<string, {
    push: (s: ForkStatus) => void;
    close: () => void;
    iterable: AsyncIterable<ForkStatus>;
  }>();

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
            else if (closed) resolve({ value: undefined as unknown as ForkStatus, done: true });
            else resolvers.push(resolve);
          }),
      }),
    };
    streams.set(forkId, { push, close, iterable });
    return iterable;
  }

  const foreignCredentials: ForeignCredentialsPort = {
    mintForeignToken: async () =>
      ok({ accessToken: "fake-token", agentIdentifier: "fork-inst-1-aaaabbbbcccc" }),
    ...overrides.foreignCredentials,
  };

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
    foreignCredentials,
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
      instanceId: "inst-1",
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

  it("emits ForkFailed(CredentialMintFailed) when the credentials port errors — no fallback", async () => {
    const h = makeHarness({
      foreignCredentials: {
        mintForeignToken: async () =>
          err({ kind: "TokenExchangeFailed", detail: "401 unauthorized" }),
      },
    });
    await h.service.openFork({
      instanceId: "inst-1",
      foreignSub: "kc|user-42",
      replyId: "reply-1",
    });

    expect(h.calls.createdForks).toEqual([]);
    expect(h.events).toEqual([
      {
        type: EventType.ForkFailed,
        forkId: "fork-1",
        replyId: "reply-1",
        reason: "CredentialMintFailed",
        detail: "401 unauthorized",
      },
    ]);
  });

  it("emits ForkFailed(OrchestrationFailed) when orchestrator.createFork errors", async () => {
    const h = makeHarness({
      orchestrator: {
        createFork: async () => err({ kind: "WriteFailed", detail: "apiserver 503" }),
      },
    });
    await h.service.openFork({
      instanceId: "inst-1",
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
      instanceId: "inst-1",
      foreignSub: "kc|user-42",
      replyId: "reply-1",
    });
    h.statusStream("fork-1", [
      { phase: "Failed", error: { reason: "PodNotReady", detail: "CrashLoopBackOff" } },
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

  it("rejects empty foreignSub", async () => {
    const h = makeHarness({});
    await expect(
      h.service.openFork({
        instanceId: "inst-1",
        foreignSub: "",
        replyId: "reply-1",
      }),
    ).rejects.toThrow();
  });
});

describe("ForksService.openFork — Envoy path (experimentalCredentialInjector=true)", () => {
  it("skips the foreign-credentials mint and creates the fork without an accessToken", async () => {
    let mintCalls = 0;
    const orchestratorCalls: Array<{ forkId: string; accessToken?: string; forkAgentIdentifier: string }> = [];
    const h = makeHarness({
      foreignCredentials: {
        mintForeignToken: async () => {
          mintCalls++;
          return ok({ accessToken: "should-not-be-used", agentIdentifier: "should-not-be-used" });
        },
      },
      orchestrator: {
        createFork: async ({ forkId, spec, accessToken }) => {
          orchestratorCalls.push({ forkId, accessToken, forkAgentIdentifier: spec.forkAgentIdentifier });
          return ok(undefined);
        },
      },
    });

    await h.service.openFork({
      instanceId: "inst-1",
      foreignSub: "kc|user-42",
      replyId: "reply-1",
      experimentalCredentialInjector: true,
    });
    h.statusStream("fork-1", [{ phase: "Ready", podIP: "10.0.0.7" }]);
    await h.streamDone();

    expect(mintCalls).toBe(0);
    expect(orchestratorCalls).toEqual([
      { forkId: "fork-1", accessToken: undefined, forkAgentIdentifier: "" },
    ]);
    expect(h.events).toEqual([
      {
        type: EventType.ForkReady,
        forkId: "fork-1",
        replyId: "reply-1",
        podIP: "10.0.0.7",
      },
    ]);
  });

  it("emits ForkFailed(OrchestrationFailed) when the controller can't write the ConfigMap", async () => {
    const h = makeHarness({
      orchestrator: {
        createFork: async () => err({ kind: "WriteFailed", detail: "apiserver 503" }),
      },
    });

    await h.service.openFork({
      instanceId: "inst-1",
      foreignSub: "kc|user-42",
      replyId: "reply-1",
      experimentalCredentialInjector: true,
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
});

describe("ForksService.closeFork", () => {
  it("deletes the K8s fork and emits ForkCompleted after a Ready fork", async () => {
    const h = makeHarness({});
    await h.service.openFork({
      instanceId: "inst-1",
      foreignSub: "kc|user-42",
      replyId: "reply-1",
    });
    h.statusStream("fork-1", [{ phase: "Ready", podIP: "10.0.0.5" }]);
    await h.streamDone();
    h.events.length = 0;

    await h.service.closeFork("fork-1");

    expect(h.calls.deletedForks).toEqual(["fork-1"]);
    expect(h.events).toEqual([{ type: EventType.ForkCompleted, forkId: "fork-1" }]);
  });

  it("is a no-op for unknown forkIds", async () => {
    const h = makeHarness({});
    await h.service.closeFork("unknown");
    expect(h.calls.deletedForks).toEqual([]);
    expect(h.events).toEqual([]);
  });

  it("does not emit Completed after a fork has Failed (no illegal transition)", async () => {
    const h = makeHarness({
      foreignCredentials: {
        mintForeignToken: async () => err({ kind: "TokenExchangeFailed" }),
      },
    });
    await h.service.openFork({
      instanceId: "inst-1",
      foreignSub: "kc|user-42",
      replyId: "reply-1",
    });
    h.events.length = 0;

    await h.service.closeFork("fork-1");
    expect(h.calls.deletedForks).toEqual([]);
    expect(h.events).toEqual([]);
  });
});
