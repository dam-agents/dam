import { describe, it, expect, vi, afterEach } from "vitest";

// TEST_OVERVIEW: The redis bus registers a channel's listeners synchronously but subscribes to Redis asynchronously. A failed SUBSCRIBE must be retried while listeners remain, or the channel stays in the map forever with no Redis subscription behind it and the stream goes silent after its opening sync.

type MessageHandler = (channel: string, payload: string) => void;

const { FakeRedis, instances } = vi.hoisted(() => {
  const instances: FakeRedisInstance[] = [];
  class FakeRedis {
    handlers = new Map<string, MessageHandler>();
    subscribeCalls: string[] = [];
    subscribeImpl: (channel: string) => Promise<unknown> = () =>
      Promise.resolve(1);
    constructor() {
      instances.push(this as unknown as FakeRedisInstance);
    }
    on(event: string, fn: MessageHandler) {
      this.handlers.set(event, fn);
      return this;
    }
    subscribe(channel: string) {
      this.subscribeCalls.push(channel);
      return this.subscribeImpl(channel);
    }
    unsubscribe() {
      return Promise.resolve();
    }
    publish() {
      return Promise.resolve(1);
    }
    quit() {
      return Promise.resolve();
    }
  }
  interface FakeRedisInstance {
    subscribeCalls: string[];
    subscribeImpl: (channel: string) => Promise<unknown>;
  }
  return { FakeRedis, instances };
});

vi.mock("ioredis", () => ({ default: FakeRedis, Redis: FakeRedis }));

afterEach(() => {
  vi.useRealTimers();
  instances.length = 0;
  vi.resetModules();
});

describe("redis bus SUBSCRIBE retry", () => {
  // TEST_SCENARIO: A rejected initial SUBSCRIBE is retried after the backoff, so a channel whose first subscribe lost a race with a reconnect still ends up subscribed rather than silently dead.
  it("retries a rejected SUBSCRIBE until it succeeds", async () => {
    vi.useFakeTimers();
    const { createRedisBus } = await import("../../core/redis-bus.js");
    const bus = createRedisBus("redis://unused");
    const subscriber = instances[1];

    let attempts = 0;
    subscriber.subscribeImpl = () => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new Error("connection not ready"))
        : Promise.resolve(1);
    };

    bus.subscribe("events:owner:u1", () => {});

    await vi.advanceTimersByTimeAsync(0);
    expect(subscriber.subscribeCalls).toEqual(["events:owner:u1"]);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(subscriber.subscribeCalls).toEqual([
      "events:owner:u1",
      "events:owner:u1",
    ]);

    await bus.close();
  });

  // TEST_SCENARIO: Once the last listener leaves, a pending retry must not resurrect the subscription.
  it("stops retrying after the channel's last listener unsubscribes", async () => {
    vi.useFakeTimers();
    const { createRedisBus } = await import("../../core/redis-bus.js");
    const bus = createRedisBus("redis://unused");
    const subscriber = instances[1];
    subscriber.subscribeImpl = () => Promise.reject(new Error("down"));

    const unsubscribe = bus.subscribe("events:owner:u2", () => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(subscriber.subscribeCalls).toEqual(["events:owner:u2"]);

    unsubscribe();
    await vi.advanceTimersByTimeAsync(6_000);
    expect(subscriber.subscribeCalls).toEqual(["events:owner:u2"]);

    await bus.close();
  });
});
