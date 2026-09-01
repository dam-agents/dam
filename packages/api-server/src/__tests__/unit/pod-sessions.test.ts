import { describe, expect, it, vi } from "vitest";
import type { PodSessionsNotice } from "api-server-api";
import {
  createPodSessionsService,
  type PodSessionsDeps,
} from "../../modules/live-events/services/pod-sessions-service.js";

// TEST_OVERVIEW: the owner-scoped holder's lifecycle edges — sync-first, fan-out, teardown, overflow, raced and failed reconciles.

interface Harness {
  deps: PodSessionsDeps;
  running: string[];
  notify: (agentId: string) => void;
  agentsChanged: () => void;
  openWatches: () => string[];
  closedWatches: string[];
  signalStops: number;
}

function harness(): Harness {
  const watches = new Map<string, () => void>();
  const closedWatches: string[] = [];
  let onAgents: (() => void) | undefined;
  const state: Harness = {
    running: [],
    notify: (agentId) => watches.get(agentId)?.(),
    agentsChanged: () => onAgents?.(),
    openWatches: () => [...watches.keys()],
    closedWatches,
    signalStops: 0,
    deps: {
      listRunningAgentIds: async () => state.running,
      watchAgent: (agentId, onNotice) => {
        watches.set(agentId, onNotice);
        return {
          close: () => {
            watches.delete(agentId);
            closedWatches.push(agentId);
          },
        };
      },
      onAgentsChanged: (_owner, listener) => {
        onAgents = listener;
        return () => {
          state.signalStops += 1;
        };
      },
      log: () => {},
    },
  };
  return state;
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("createPodSessionsService", () => {
  it("opens with sync, then fans out per-agent notices", async () => {
    const h = harness();
    h.running = ["a1"];
    const service = createPodSessionsService(h.deps);
    const stream = service.ownerStream("owner")[Symbol.asyncIterator]();

    expect((await stream.next()).value).toEqual({ topic: "sync" });
    await flush();
    expect(h.openWatches()).toEqual(["a1"]);

    h.notify("a1");
    expect((await stream.next()).value).toEqual({
      topic: "sessions",
      agentId: "a1",
    });
  });

  it("tears everything down with the last subscriber", async () => {
    const h = harness();
    h.running = ["a1"];
    const service = createPodSessionsService(h.deps);
    const abort = new AbortController();
    const stream = service
      .ownerStream("owner", abort.signal)
      [Symbol.asyncIterator]();
    await stream.next();
    await flush();

    abort.abort();
    expect((await stream.next()).done).toBe(true);
    expect(h.closedWatches).toEqual(["a1"]);
    expect(h.signalStops).toBe(1);
  });

  it("reconciles watches when the running set changes", async () => {
    const h = harness();
    h.running = ["a1"];
    const service = createPodSessionsService(h.deps);
    const stream = service.ownerStream("owner")[Symbol.asyncIterator]();
    await stream.next();
    await flush();

    h.running = ["a2"];
    h.agentsChanged();
    await flush();
    expect(h.openWatches()).toEqual(["a2"]);
    expect(h.closedWatches).toEqual(["a1"]);
  });

  it("re-runs a reconcile that was raced by an agents change", async () => {
    const h = harness();
    let calls = 0;
    let releaseFirst: (() => void) | undefined;
    h.deps.listRunningAgentIds = () => {
      calls += 1;
      if (calls === 1)
        return new Promise((resolve) => {
          releaseFirst = () => resolve([]);
        });
      return Promise.resolve([]);
    };
    const service = createPodSessionsService(h.deps);
    const stream = service.ownerStream("owner")[Symbol.asyncIterator]();
    await stream.next();

    h.agentsChanged();
    releaseFirst?.();
    await flush();
    expect(calls).toBe(2);
  });

  it("collapses an overflowing queue into one sync", async () => {
    const h = harness();
    h.running = ["a1"];
    const service = createPodSessionsService(h.deps);
    const stream = service.ownerStream("owner")[Symbol.asyncIterator]();
    await stream.next();
    await flush();

    for (let i = 0; i < 300; i += 1) h.notify("a1");
    expect((await stream.next()).value).toEqual({ topic: "sync" });
  });

  it("retries a failed reconcile", async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      let calls = 0;
      h.deps.listRunningAgentIds = () => {
        calls += 1;
        if (calls === 1) return Promise.reject(new Error("k8s down"));
        return Promise.resolve(["a1"]);
      };
      const service = createPodSessionsService(h.deps);
      const iterator: AsyncIterator<PodSessionsNotice> = service
        .ownerStream("owner")
        [Symbol.asyncIterator]();
      await iterator.next();
      await vi.advanceTimersByTimeAsync(0);
      expect(h.openWatches()).toEqual([]);

      await vi.advanceTimersByTimeAsync(5_000);
      expect(calls).toBe(2);
      expect(h.openWatches()).toEqual(["a1"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
