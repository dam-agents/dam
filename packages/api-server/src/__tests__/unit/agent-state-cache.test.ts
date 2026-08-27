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

function fakeInformer(objects: KubeObject[] = []) {
  const cached = new Map(objects.map((o) => [o.metadata?.name ?? "", o]));
  const handlers = new Map<string, Array<(arg?: unknown) => void>>();
  const informer = {
    on(verb: string, cb: (arg?: unknown) => void) {
      handlers.set(verb, [...(handlers.get(verb) ?? []), cb]);
    },
    off() {},
    start: () => Promise.resolve(),
    stop: () => Promise.resolve(),
    get: (name: string) => cached.get(name),
    list: () => [...cached.values()],
  } as unknown as AgentInformer;
  const fire = (verb: string, arg?: unknown) => {
    for (const cb of handlers.get(verb) ?? []) cb(arg);
  };
  return { informer, cached, fire };
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

describe("agent state cache", () => {
  // TEST_SCENARIO: Before the initial sync completes the cache cannot tell "absent" from "unseen", so it reads live.
  it("reads live until the informer connects", async () => {
    const { client, store } = fakeK8s([agent("a1")]);
    const { cache, fire } = cacheOver([], client);

    expect(await cache.get("a1")).not.toBeNull();

    store.delete("a1");
    expect(await cache.get("a1")).toBeNull();
    fire("connect");
    expect(await cache.get("a1")).toBeNull();
  });

  // TEST_SCENARIO: Once synced, reads are served from the cache and never reach the API.
  it("serves reads from the cache once synced", async () => {
    const { client } = fakeK8s([]);
    const liveGet = vi.spyOn(client, "getCustomObject");
    const { cache, fire } = cacheOver([agent("a1")], client);
    fire("connect");

    expect(await cache.get("a1")).not.toBeNull();
    expect(await cache.get("missing")).toBeNull();
    expect(liveGet).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: Owner scoping survives the move off the server-side label selector.
  it("filters a synced listing by owner", async () => {
    const objects = [agent("a1", "kc|one"), agent("a2", "kc|two")];
    const { cache, fire } = cacheOver(objects, fakeK8s(objects).client);
    fire("connect");

    expect((await cache.list("kc|one")).map((o) => o.metadata?.name)).toEqual([
      "a1",
    ]);
    expect(await cache.list()).toHaveLength(2);
  });

  // TEST_SCENARIO: A desync reverts to live reads rather than serving a frozen view.
  it("reverts to live reads when the informer errors", async () => {
    const { client } = fakeK8s([agent("fresh")]);
    const { cache, fire } = cacheOver([agent("stale")], client);
    fire("connect");
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

  // TEST_SCENARIO: A desync releases waiters so a polling caller re-checks instead of sleeping through the gap.
  it("releases waiters on desync", async () => {
    const { cache, fire } = cacheOver([]);
    const sub = cache.whenChanged("a1");
    fire("error", new Error("dropped"));
    await expect(sub.changed).resolves.toBeUndefined();
  });
});

describe("poll wake-up", () => {
  // TEST_SCENARIO: A change mid-sleep cuts the wait short instead of paying the full interval.
  it("re-checks as soon as the cache reports a change", async () => {
    const { cache, fire } = cacheOver([]);
    let checks = 0;
    const started = Date.now();

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
    await vi.waitFor(() => expect(checks).toBe(1));
    fire("update", agent("a1"));

    expect(await result).toBe(true);
    expect(Date.now() - started).toBeLessThan(1_000);
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
