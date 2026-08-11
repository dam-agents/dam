import { describe, it, expect, afterEach, vi } from "vitest";
import { createWorld, frames } from "./acp-world.js";

/**
 * Feature: connecting to a sandbox.
 *
 * Written from the client's side of the socket. A scenario says what someone
 * did and what they should observe; the harness, the spawn gate, and the
 * buffering that make it work are implementation detail and are never named
 * in an assertion.
 *
 * See `acp-runtime.test.ts` for the older mechanism-oriented suite. The two
 * overlap on purpose until the session-lifecycle refactor (#3108) lands.
 */

/** Let the runtime's `exited` promise handler run. */
const flushMicrotasks = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

describe("acp-runtime: connecting", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("should spawn a single harness for the first client and reuse the same instance for the next", () => {
    const world = createWorld();

    // A sandbox with nobody connected runs no harness at all.
    expect(world.harnessCount()).toBe(0);

    const first = world.connect();
    first.send(frames.initialize(1));
    expect(world.harnessCount()).toBe(1);

    // A colleague opens the same sandbox. Their traffic lands on the harness
    // that is already running: a second one would mean a second ~300MB
    // subprocess and a conversation split across two of them.
    const second = world.connect();
    second.send(frames.listSessions(2));

    expect(world.harness().receivedMethods()).toEqual([
      "initialize",
      "session/list",
    ]);
    expect(world.harnessCount()).toBe(1);
  });

  it("should refuse a client that connects after the harness has died, and not restart it", async () => {
    const world = createWorld();
    const first = world.connect();

    world.harness().exit();
    await flushMicrotasks();
    expect(first.isOpen()).toBe(false);

    // Someone opens a new tab against a sandbox whose harness is gone. They
    // get a closed socket with a reason, not a connection that hangs.
    const harnessesBeforeReconnect = world.harnessCount();
    const late = world.connect();

    expect(late.isOpen()).toBe(false);
    expect(late.closes[0]).toMatchObject({
      code: 1011,
      reason: "agent process is not running",
    });
    // Death is a one-way latch, so connecting does not spawn a replacement
    // the way it spawned the first one. Recovering the pod is the
    // controller's job, not the next client's.
    expect(world.harnessCount()).toBe(harnessesBeforeReconnect);
  });

  it("should hold a client's messages until its config arrives, then replay them in order", () => {
    // Cold boot: the pod is up but the agent's env has not been delivered yet.
    const world = createWorld({ envReadyAtBoot: false });
    const client = world.connect();

    client.send(frames.initialize(1));
    client.send(frames.newSession(2));
    client.send(frames.listSessions(3));

    // Nothing has started, so nothing can have been answered with stale env.
    expect(world.harnessCount()).toBe(0);

    world.runtime.refreshEnv({ force: false });

    expect(world.harnessCount()).toBe(1);
    expect(world.harness().receivedMethods()).toEqual([
      "initialize",
      "session/new",
      "session/list",
    ]);
  });

  it("should let a client through when its config never arrives", () => {
    vi.useFakeTimers();

    const world = createWorld({
      envReadyAtBoot: false,
      warmStartTimeoutMs: 15_000,
    });
    const client = world.connect();
    client.send(frames.initialize(1));

    expect(world.harnessCount()).toBe(0);

    // Config delivery has failed. The client must not wait forever, so the
    // gate opens on its own and the sandbox starts with whatever env it has.
    vi.advanceTimersByTime(15_000);

    expect(world.harnessCount()).toBe(1);
    expect(world.harness().receivedMethods()).toEqual(["initialize"]);
    expect(client.isOpen()).toBe(true);
  });
});
