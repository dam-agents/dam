import { describe, it, expect, vi } from "vitest";
import {
  AGENT_CHANGE_CHANNEL,
  createAgentChangeFeed,
  parseAgentChange,
  type ReadOnlyChangeSource,
} from "../../modules/agent-store/feed.js";

// TEST_OVERVIEW: the feed is the only way the api-server learns that an Agent changed while the controller writes it. It must not lose a change that commits between its list and its subscription, it must not apply a change before the snapshot that change belongs to, and a reconnect must list again rather than trust anything it remembered. These specs pin the order, the buffering, the releases and the retry.

type Payload = (payload: string) => void;

function source(): {
  source: ReadOnlyChangeSource;
  emit: (payload: object) => void;
  listenChannel: () => string | undefined;
  listenedTimes: () => number;
  unlistened: () => number;
  failNextListens: (count: number) => void;
} {
  let channel: string | undefined;
  let onPayload: Payload | undefined;
  let listens = 0;
  let unlistens = 0;
  let failures = 0;

  return {
    source: {
      async listen(name, callback) {
        listens += 1;
        if (failures > 0) {
          failures -= 1;
          throw new Error("the channel is unavailable");
        }
        channel = name;
        onPayload = callback;
        return {
          async unlisten() {
            unlistens += 1;
            channel = undefined;
          },
        };
      },
    },
    emit: (payload) => onPayload?.(JSON.stringify(payload)),
    listenChannel: () => channel,
    listenedTimes: () => listens,
    unlistened: () => unlistens,
    failNextListens: (count) => {
      failures = count;
    },
  };
}

const agentChanged = (id: string) => ({ t: "agents", op: "U", id });
const budgetChanged = { t: "user_budgets", op: "U" };

describe("agent change feed", () => {
  // TEST_SCENARIO: A change that commits between the list and the subscribe is lost for good, and it is exactly the one a waiter waits for. The feed subscribes first, so anything arriving while the list runs is held and applied after it.
  it("listens before it lists, and buffers what arrives in between", async () => {
    const fake = source();
    const order: string[] = [];
    let held: Promise<void> = Promise.resolve();

    const feed = createAgentChangeFeed({
      source: fake.source,
      snapshot: async () => {
        order.push("list");
        held = new Promise<void>((resolve) => {
          setTimeout(resolve, 10);
        });
        await held;
      },
      log: () => {},
    });

    const started = feed.start();
    await Promise.resolve();
    await Promise.resolve();

    const waiter = feed.whenChanged("agent-abc");
    fake.emit(agentChanged("agent-abc"));

    let released = false;
    void waiter.changed.then(() => {
      released = true;
    });
    await Promise.resolve();
    expect(released).toBe(false);

    await started;
    await waiter.changed;
    expect(released).toBe(true);
    expect(order).toEqual(["list"]);
    expect(fake.listenChannel()).toBe(AGENT_CHANGE_CHANNEL);
  });

  // TEST_SCENARIO: A payload names the Agent, and only that Agent's waiters wake. A budget's notification names no record — its key is the owner's subject — so it wakes every waiter rather than leaking that subject through the channel.
  it("releases the Agent a payload names, and everyone for one that names none", async () => {
    const fake = source();
    const feed = createAgentChangeFeed({
      source: fake.source,
      snapshot: async () => {},
      log: () => {},
    });
    await feed.start();

    const one = feed.whenChanged("agent-1");
    const two = feed.whenChanged("agent-2");
    const woke = vi.fn();
    void one.changed.then(woke);

    fake.emit(agentChanged("agent-2"));
    await two.changed;
    expect(woke).not.toHaveBeenCalled();

    fake.emit(budgetChanged);
    await one.changed;
    expect(woke).toHaveBeenCalled();
  });

  // TEST_SCENARIO: A payload a future release invents, or a broken one, must not throw inside the driver's callback: the feed ignores it and the next relist corrects anything it would have carried.
  it("ignores a payload it cannot read", async () => {
    const fake = source();
    const feed = createAgentChangeFeed({
      source: fake.source,
      snapshot: async () => {},
      log: () => {},
    });
    await feed.start();

    const waiter = feed.whenChanged("agent-1");
    expect(() =>
      fake.emit({ t: "agents", op: "X", id: "agent-1" }),
    ).not.toThrow();
    expect(parseAgentChange("not json")).toBeNull();
    waiter.cancel();
  });

  // TEST_SCENARIO: A channel that is down at boot must not take the api-server's cache with it. The feed retries with a growing delay and lists once it is subscribed, and a half-open connection is bounded by the relist on an interval.
  it("retries a channel that is down, then lists and relists", async () => {
    const fake = source();
    fake.failNextListens(2);
    const snapshots = vi.fn(async () => {});
    const feed = createAgentChangeFeed({
      source: fake.source,
      snapshot: snapshots,
      log: () => {},
      relistIntervalMs: 5,
    });

    await feed.start();
    expect(fake.listenedTimes()).toBe(3);
    expect(snapshots).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(snapshots.mock.calls.length).toBeGreaterThan(1);
    await feed.stop();
    expect(fake.unlistened()).toBe(1);
  });
});
