import { describe, it, expect } from "vitest";
import type { LiveEvent } from "api-server-api";
import type { RedisBus } from "../../core/redis-bus.js";
import { composeLiveEventsModule } from "../../modules/live-events/compose.js";
import { hintFor } from "../../modules/live-events/sagas/live-hints.js";
import { emit, EventType } from "../../events.js";

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

function harness(editors: Record<string, string[]> = {}) {
  const { bus, subscribedChannels } = fakeRedisBus();
  const warnings: string[] = [];
  const module = composeLiveEventsModule({
    bus,
    log: (m) => warnings.push(m),
    k8s: { watchCustomObjects: () => () => {} },
    onAgentChanged: () => {},
    editorsOf: async (agentId) => editors[agentId] ?? [],
  });
  return { bus, subscribedChannels, warnings, module };
}

const owner = (sub: string) => ({ sub, editorEmail: null });

function publishRaw(bus: RedisBus, ownerSub: string, payload: string) {
  return bus.publish(`events:owner:${ownerSub}`, payload);
}

function publish(bus: RedisBus, ownerSub: string, event: LiveEvent) {
  return publishRaw(bus, ownerSub, JSON.stringify(event));
}

describe("liveEvents.ownerStream", () => {
  it("opens with sync, then relays this owner's hints in order", async () => {
    const { bus, module } = harness();
    const it_ = module.liveEvents
      .ownerStream(owner("u1"))
      [Symbol.asyncIterator]();

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
    const it_ = module.liveEvents
      .ownerStream(owner("u1"))
      [Symbol.asyncIterator]();
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
    const it_ = module.liveEvents
      .ownerStream(owner("u1"))
      [Symbol.asyncIterator]();
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
    const it_ = module.liveEvents
      .ownerStream(owner("u1"))
      [Symbol.asyncIterator]();
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
    const it_ = module.liveEvents
      .ownerStream(owner("u1"))
      [Symbol.asyncIterator]();

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
      .ownerStream(owner("u1"), controller.signal)
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

describe("liveEvents.ownerStream for an Agent Editor", () => {
  // TEST_SCENARIO: A person signed in with a verified email listens on two audiences: their own user id, and their email, where hints about Agents shared with them arrive. Aborting releases both.
  it("carries hints sent to the person's email, and releases both audiences on abort", async () => {
    const { bus, module, subscribedChannels } = harness();
    const controller = new AbortController();
    const it_ = module.liveEvents
      .ownerStream(
        { sub: "u2", editorEmail: "ed@example.com" },
        controller.signal,
      )
      [Symbol.asyncIterator]();
    await it_.next();
    expect(subscribedChannels().sort()).toEqual([
      "events:owner:email:ed@example.com",
      "events:owner:u2",
    ]);

    await publish(bus, "email:ed@example.com", {
      topic: "agents",
      agentId: "shared",
    });
    expect((await it_.next()).value).toEqual({
      topic: "agents",
      agentId: "shared",
    });

    const pending = it_.next();
    controller.abort();
    expect((await pending).done).toBe(true);
    expect(subscribedChannels()).toEqual([]);
  });

  // TEST_SCENARIO: Every publisher addresses an Agent's owner. An Agent Editor sees the Agent in their own sidebar, so each agents hint about it is copied to the email of every editor on its Editor List.
  it("copies an agents hint about a shared Agent to its editors", async () => {
    const { module } = harness({ a1: ["ed@example.com"] });
    module.start();
    const it_ = module.liveEvents
      .ownerStream({ sub: "u2", editorEmail: "ed@example.com" })
      [Symbol.asyncIterator]();
    await it_.next();

    emit({ type: EventType.AgentUpdated, agentId: "a1", ownerSub: "u1" });
    expect((await it_.next()).value).toEqual({
      topic: "agents",
      agentId: "a1",
    });
    module.stop();
  });

  // TEST_SCENARIO: A person added to or removed from an Editor List gets the Agent into or out of their sidebar at once, including when the owner deletes the Agent and its list goes with it.
  it("tells each added or removed person when an Editor List changes", async () => {
    const { module } = harness();
    module.start();
    const it_ = module.liveEvents
      .ownerStream({ sub: "u2", editorEmail: "ed@example.com" })
      [Symbol.asyncIterator]();
    await it_.next();

    emit({
      type: EventType.AgentEditorsChanged,
      agentId: "a1",
      emails: ["ed@example.com"],
    });
    expect((await it_.next()).value).toEqual({
      topic: "agents",
      agentId: "a1",
    });
    module.stop();
  });
});

describe("hintFor", () => {
  it("projects the owner-carrying events to their topics", () => {
    expect(
      hintFor({
        type: EventType.AgentCreated,
        agentId: "a1",
        ownerSub: "u1",
        character: "stack",
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

  it("projects an Editor List change to the owner and every changed email", () => {
    expect(
      hintFor({
        type: EventType.AgentEditorsChanged,
        agentId: "a1",
        ownerSub: "u1",
        emails: ["ed@example.com"],
      }),
    ).toEqual({
      ownerSub: "u1",
      hint: { topic: "agents", agentId: "a1" },
      editorEmails: ["ed@example.com"],
    });
  });

  it("projects nothing for events that carry no owner (yet)", () => {
    expect(hintFor({ type: EventType.AgentUpdated, agentId: "a1" })).toBeNull();
  });

  // TEST_SCENARIO: every agent change the UI must see live — the onboarding stamp, a checklist write, a workspace seed or install settling — is one AgentUpdated; it reaches the owner's channel exactly when its emitter named the owner.
  it("projects an agents hint when an agent update names its owner", () => {
    expect(
      hintFor({ type: EventType.AgentUpdated, agentId: "a1", ownerSub: "u1" }),
    ).toEqual({ ownerSub: "u1", hint: { topic: "agents", agentId: "a1" } });
  });

  // TEST_SCENARIO: binding presence decides whether an Agent's default-model notice exists at all, so a Slack connect or disconnect must reach the owner's open tabs whatever tab performed it; the event reaches the attention family exactly when its emitter named the owner.
  it("projects an attention hint from a Slack binding change", () => {
    expect(
      hintFor({
        type: EventType.SlackConnected,
        agentId: "a1",
        slackChannelId: "C1",
        ownerSub: "u1",
      }),
    ).toEqual({ ownerSub: "u1", hint: { topic: "attention", agentId: "a1" } });
    expect(
      hintFor({
        type: EventType.SlackDisconnected,
        agentId: "a1",
        slackChannelId: "C1",
        ownerSub: "u1",
      }),
    ).toEqual({ ownerSub: "u1", hint: { topic: "attention", agentId: "a1" } });
    expect(
      hintFor({ type: EventType.SlackDisconnected, agentId: "a1" }),
    ).toBeNull();
  });

  // TEST_SCENARIO: a Telegram binding decides the same notice as a Slack one, so a bind or an unbind must reach the owner's attention query too.
  it("projects an attention hint from a Telegram binding change", () => {
    expect(
      hintFor({
        type: EventType.TelegramChatBound,
        agentId: "a1",
        ownerSub: "u1",
      }),
    ).toEqual({ ownerSub: "u1", hint: { topic: "attention", agentId: "a1" } });
    expect(
      hintFor({
        type: EventType.TelegramChatUnbound,
        agentId: "a1",
        ownerSub: "u1",
      }),
    ).toEqual({ ownerSub: "u1", hint: { topic: "attention", agentId: "a1" } });
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
