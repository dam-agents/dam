import { describe, it, expect, vi } from "vitest";
import { fakeK8s } from "../helpers/fake-k8s.js";
import {
  startAgentStateCache,
  createLiveAgentStateCache,
} from "../../modules/agents/infrastructure/agent-state-cache.js";
import type { AgentInformer } from "../../modules/agents/infrastructure/k8s.js";
import type { KubeObject } from "../../modules/agents/infrastructure/k8s.js";
import { createAgentsRepository } from "../../modules/agents/index.js";
import { pollUntilReady } from "../../modules/agents/infrastructure/poll-until-ready.js";
import { LABEL_OWNER } from "../../modules/agents/infrastructure/labels.js";

const NS = "test-agents";

function agent(name: string, owner = "kc|one"): KubeObject {
  return {
    metadata: { name, namespace: NS, labels: { [LABEL_OWNER]: owner } },
    status: { conditions: [] },
  } as KubeObject;
}

// TEST_OVERVIEW: Models the pinned client's ListWatch ordering — connect fires before the initial list lands, and an error stops the watch for good until start() is called again.
function fakeInformer(objects: KubeObject[] = []) {
  const cached = new Map<string, KubeObject>();
  const handlers = new Map<string, Array<(arg?: unknown) => void>>();
  let starts = 0;
  let failStart: unknown = null;
  const fire = (verb: string, arg?: unknown) => {
    for (const cb of handlers.get(verb) ?? []) cb(arg);
  };
  const informer = {
    on(verb: string, cb: (arg?: unknown) => void) {
      handlers.set(verb, [...(handlers.get(verb) ?? []), cb]);
    },
    off() {},
    async start() {
      starts += 1;
      fire("connect");
      await Promise.resolve();
      if (failStart) throw failStart;
      for (const o of objects) cached.set(o.metadata?.name ?? "", o);
    },
    stop: () => Promise.resolve(),
    get: (name: string) => cached.get(name),
    list: () => [...cached.values()],
  } as unknown as AgentInformer;
  return {
    informer,
    cached,
    fire,
    startCount: () => starts,
    failNextStart: (err: unknown) => {
      failStart = err;
    },
    healStart: () => {
      failStart = null;
    },
  };
}

function cacheOver(objects: KubeObject[], live = fakeK8s(objects).client) {
  const f = fakeInformer(objects);
  const cache = startAgentStateCache({
    informer: f.informer,
    live,
    namespace: NS,
    log: () => {},
  });
  return { cache, ...f };
}

async function settled<T>(value: T): Promise<T> {
  await Promise.resolve();
  await Promise.resolve();
  return value;
}

describe("agent state cache", () => {
  // TEST_SCENARIO: connect fires before the initial list lands, so it must not mark the cache usable — an empty store would report every agent absent.
  it("reads live until the initial list has landed", async () => {
    const { client } = fakeK8s([agent("a1")]);
    const { cache } = cacheOver([agent("a1")], client);

    const duringWindow = cache.get("a1");
    const listedInWindow = cache.list();
    expect(await duringWindow).not.toBeNull();
    expect(await listedInWindow).toHaveLength(1);

    await settled(null);
    expect(await cache.get("a1")).not.toBeNull();
  });

  // TEST_SCENARIO: The watch stops on error, so the cache must restart it rather than serving live reads forever.
  it("restarts the informer after an error", async () => {
    vi.useFakeTimers();
    try {
      const { client } = fakeK8s([agent("a1")]);
      const f = cacheOver([agent("a1")], client);
      await settled(null);
      expect(f.startCount()).toBe(1);

      f.fire("error", new Error("watch dropped"));
      expect(f.startCount()).toBe(1);

      await vi.advanceTimersByTimeAsync(5_000);

      expect(f.startCount()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  // TEST_SCENARIO: A cache stopped for shutdown must not keep restarting its informer.
  it("stops restarting once stopped", async () => {
    vi.useFakeTimers();
    try {
      const f = cacheOver([]);
      await settled(null);
      f.fire("error", new Error("dropped"));
      await f.cache.stop();

      await vi.advanceTimersByTimeAsync(20_000);

      expect(f.startCount()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // TEST_SCENARIO: Once synced, reads are served from the cache and never reach the API.
  it("serves reads from the cache once synced", async () => {
    const { client } = fakeK8s([]);
    const liveGet = vi.spyOn(client, "getCustomObject");
    const { cache } = cacheOver([agent("a1")], client);
    await settled(null);

    expect(await cache.get("a1")).not.toBeNull();
    expect(await cache.get("missing")).toBeNull();
    expect(liveGet).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: Owner scoping survives the move off the server-side label selector.
  it("filters a synced listing by owner", async () => {
    const objects = [agent("a1", "kc|one"), agent("a2", "kc|two")];
    const { cache, fire } = cacheOver(objects, fakeK8s(objects).client);
    await settled(null);

    expect((await cache.list("kc|one")).map((o) => o.metadata?.name)).toEqual([
      "a1",
    ]);
    expect(await cache.list()).toHaveLength(2);
  });

  // TEST_SCENARIO: A desync reverts to live reads rather than serving a frozen view.
  it("reverts to live reads when the informer errors", async () => {
    const { client } = fakeK8s([agent("fresh")]);
    const { cache, fire } = cacheOver([agent("stale")], client);
    await settled(null);
    expect(await cache.get("stale")).not.toBeNull();

    fire("error", new Error("watch dropped"));

    expect(await cache.get("stale")).toBeNull();
    expect(await cache.get("fresh")).not.toBeNull();
  });

  // TEST_SCENARIO: A waiter is released by a change to its own agent, not another's.
  it("wakes only the waiter for the changed agent", async () => {
    const { cache, fire } = cacheOver([]);
    let woken = false;
    const sub = cache.whenChanged("a1");
    void sub.changed.then(() => {
      woken = true;
    });

    fire("update", agent("a2"));
    await Promise.resolve();
    expect(woken).toBe(false);

    fire("update", agent("a1"));
    await sub.changed;
    expect(woken).toBe(true);
  });

  // TEST_SCENARIO: A read racing shutdown must not be answered from the stopped informer's frozen view.
  it("reads live again once stopped", async () => {
    const { client } = fakeK8s([agent("fresh")]);
    const { cache, fire } = cacheOver([agent("stale")], client);
    await settled(null);
    expect(await cache.get("stale")).not.toBeNull();

    await cache.stop();

    expect(await cache.get("stale")).toBeNull();
    expect(await cache.get("fresh")).not.toBeNull();
  });

  // TEST_SCENARIO: A desync releases waiters so a polling caller re-checks instead of sleeping through the gap.
  it("releases waiters on desync", async () => {
    const { cache, fire } = cacheOver([]);
    const sub = cache.whenChanged("a1");
    fire("error", new Error("dropped"));
    await expect(sub.changed).resolves.toBeUndefined();
  });
});

describe("poll wake-up", () => {
  // TEST_SCENARIO: A change mid-sleep re-checks without any of the 5s interval elapsing.
  it("re-checks as soon as the cache reports a change", async () => {
    vi.useFakeTimers();
    try {
      const { cache, fire } = cacheOver([]);
      let checks = 0;

      const result = pollUntilReady(
        async () => {
          checks += 1;
          return checks > 1;
        },
        {
          initialMs: 5_000,
          maxMs: 5_000,
          timeoutMs: 30_000,
          wakeOn: () => cache.whenChanged("a1"),
        },
      );
      await Promise.resolve();
      expect(checks).toBe(1);

      fire("update", agent("a1"));

      expect(await result).toBe(true);
      expect(checks).toBe(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  // TEST_SCENARIO: With no change signal the interval is the only pacing, as before.
  it("still paces itself without a wake-up", async () => {
    let checks = 0;
    const result = await pollUntilReady(
      async () => {
        checks += 1;
        return checks === 2;
      },
      { initialMs: 10, maxMs: 10, timeoutMs: 5_000 },
    );
    expect(result).toBe(true);
    expect(checks).toBe(2);
  });
});

describe("the read boundary this cache is allowed to cross", () => {
  // TEST_SCENARIO: Reporting reads may be stale; a read whose result drives a write must not be.
  it("serves reporting reads from the cache and write-adjacent reads live", async () => {
    const live = fakeK8s([agent("a1")]);
    const stale = createLiveAgentStateCache(fakeK8s([]).client);
    const repo = createAgentsRepository(live.client, stale);

    expect(await repo.get("a1")).toBeNull();
    expect(await repo.list()).toEqual([]);

    await expect(
      repo.updateSpec("a1", undefined, { cpu: "2" } as never),
    ).resolves.not.toBeNull();
  });
});
