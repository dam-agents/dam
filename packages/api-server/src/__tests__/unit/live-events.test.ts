import { describe, it, expect } from "vitest";
import type { LiveEvent } from "api-server-api";
import type { RedisBus } from "../../core/redis-bus.js";
import { composeLiveEventsModule } from "../../modules/live-events/compose.js";
import { hintFor } from "../../modules/live-events/sagas/live-hints.js";
import { EventType } from "../../events.js";

// TEST_OVERVIEW: The module's contract, exercised through its public

function fakeRedisBus() {
  const listeners = new Map<string, Set<(payload: string) => void>>();
  const bus: RedisBus = {
    async publish(channel, payload) {
      for (const fn of listeners.get(channel) ?? []) fn(payload);
    },
    subscribe(channel, listener) {
      const set = listeners.get(channel) ?? new Set();
      set.add(listener);
      listeners.set(channel, set);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(channel);
      };
    },
    async close() {},
  };
  return { bus, subscribedChannels: () => [...listeners.keys()] };
}

function harness() {
  const { bus, subscribedChannels } = fakeRedisBus();
  const warnings: string[] = [];
  const module = composeLiveEventsModule({
    bus,
    log: (m) => warnings.push(m),
    k8s: { watchCustomObjects: () => () => {} },
    namespace: "test",
    agentsRepo: { list: async () => [] },
    runtimeFeaturesFor: async () => new Map(),
  });
  return { bus, subscribedChannels, warnings, module };
}

function publishRaw(bus: RedisBus, ownerSub: string, payload: string) {
  return bus.publish(`events:owner:${ownerSub}`, payload);
}

function publish(bus: RedisBus, ownerSub: string, event: LiveEvent) {
  return publishRaw(bus, ownerSub, JSON.stringify(event));
}

describe("liveEvents.ownerStream", () => {
  it("opens with sync, then relays this owner's hints in order", async () => {
    const { bus, module } = harness();
    const it_ = module.liveEvents.ownerStream("u1")[Symbol.asyncIterator]();

    expect((await it_.next()).value).toEqual({ topic: "sync" });
    await publish(bus, "u1", { topic: "agents", agentId: "a1" });
    await publish(bus, "u1", { topic: "schedules", agentId: "a2" });
    expect((await it_.next()).value).toEqual({
      topic: "agents",
      agentId: "a1",
    });
    expect((await it_.next()).value).toEqual({
      topic: "schedules",
      agentId: "a2",
    });
  });

  it("never delivers another owner's hints", async () => {
    const { bus, module } = harness();
    const it_ = module.liveEvents.ownerStream("u1")[Symbol.asyncIterator]();
    await it_.next();

    await publish(bus, "u2", { topic: "agents", agentId: "not-yours" });
    await publish(bus, "u1", { topic: "agents", agentId: "yours" });
    expect((await it_.next()).value).toEqual({
      topic: "agents",
      agentId: "yours",
    });
  });

  it("drops non-JSON and unknown-shape frames, keeps streaming, and warns", async () => {
    const { bus, module, warnings } = harness();
    const it_ = module.liveEvents.ownerStream("u1")[Symbol.asyncIterator]();
    await it_.next();

    await publishRaw(bus, "u1", "not json");
    await publishRaw(bus, "u1", JSON.stringify({ topic: "from-the-future" }));
    await publish(bus, "u1", { topic: "agents", agentId: "a1" });

    expect((await it_.next()).value).toEqual({
      topic: "agents",
      agentId: "a1",
    });
    expect(warnings).toHaveLength(2);
  });

  it("delivers queued hints in FIFO order, duplicates included", async () => {
    const { bus, module } = harness();
    const it_ = module.liveEvents.ownerStream("u1")[Symbol.asyncIterator]();
    await it_.next();

    await publish(bus, "u1", { topic: "agents", agentId: "a1" });
    await publish(bus, "u1", { topic: "agents", agentId: "a1" });
    await publish(bus, "u1", { topic: "artifacts", artifactId: "f1" });
    expect((await it_.next()).value).toEqual({
      topic: "agents",
      agentId: "a1",
    });
    expect((await it_.next()).value).toEqual({
      topic: "agents",
      agentId: "a1",
    });
    expect((await it_.next()).value).toEqual({
      topic: "artifacts",
      artifactId: "f1",
    });
  });

  // TEST_SCENARIO: A consumer that stops reading must not hold unbounded memory: past the cap the queue collapses to a single sync, and the contract makes sync the full recovery.
  it("collapses an overflowing queue into one sync hint", async () => {
    const { bus, module } = harness();
    const it_ = module.liveEvents.ownerStream("u1")[Symbol.asyncIterator]();

    for (let i = 0; i < 400; i++) {
      await publish(bus, "u1", { topic: "agents", agentId: `a${i}` });
    }
    expect((await it_.next()).value).toEqual({ topic: "sync" });

    await publish(bus, "u1", { topic: "agents", agentId: "after" });
    expect((await it_.next()).value).toEqual({
      topic: "agents",
      agentId: "after",
    });
  });

  it("ends on abort and releases the channel subscription", async () => {
    const { bus, module, subscribedChannels } = harness();
    const controller = new AbortController();
    const it_ = module.liveEvents
      .ownerStream("u1", controller.signal)
      [Symbol.asyncIterator]();
    await it_.next();
    expect(subscribedChannels()).toEqual(["events:owner:u1"]);

    const pending = it_.next();
    controller.abort();
    expect((await pending).done).toBe(true);
    expect(subscribedChannels()).toEqual([]);

    void bus;
  });
});

describe("hintFor", () => {
  it("projects the owner-carrying events to their topics", () => {
    expect(
      hintFor({
        type: EventType.AgentCreated,
        agentId: "a1",
        ownerSub: "u1",
      }),
    ).toEqual({ ownerSub: "u1", hint: { topic: "agents", agentId: "a1" } });
    expect(
      hintFor({
        type: EventType.ScheduleFired,
        scheduleId: "s1",
        agentId: "a1",
        ownerSub: "u1",
        mode: "fresh",
        outcome: "success",
      }),
    ).toEqual({ ownerSub: "u1", hint: { topic: "schedules", agentId: "a1" } });
  });

  it("projects nothing for events that carry no owner (yet)", () => {
    expect(hintFor({ type: EventType.AgentUpdated, agentId: "a1" })).toBeNull();
  });

  // TEST_SCENARIO: A runtime's hello is what establishes whether the platform may watch its session list. That claim is stored on the Agent, which the K8s watch cannot see change, so the hello must project an agents hint of its own — otherwise an agent that says hello after a subscription is established stays out of the watch set until an unrelated event fires.
  it("projects an agents hint when a runtime says hello", () => {
    expect(
      hintFor({
        type: EventType.RuntimeHelloReceived,
        agentId: "a1",
        ownerSub: "u1",
      }),
    ).toEqual({ ownerSub: "u1", hint: { topic: "agents", agentId: "a1" } });
  });
});
