import { describe, it, expect, afterEach, vi } from "vitest";
import { createWorld, frames } from "./acp-world.js";

/**
 * Feature: connecting to a sandbox.
 *
 * Written from the client's side of the socket. A scenario says what someone
 * did and what they should observe; the harness, the spawn gate, and the
 * buffering that make it work are implementation detail and are never named
 * in an assertion.
 */

/** Let the runtime's `exited` promise handler run. */
const flushMicrotasks = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

describe("acp-runtime: connecting", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * A sandbox with nobody in it runs no harness. The first client starts one,
   * and everybody after that shares it.
   *
   * Only the runtime can arrange that. Clients connect independently and have
   * no way of knowing whether a harness is already up, and a second one would
   * cost another ~300MB subprocess and split the conversation across two
   * processes that cannot see each other's state.
   */
  it("should spawn a single harness for the first client and reuse the same instance for the next", () => {
    const world = createWorld();

    // A sandbox with nobody connected runs no harness at all.
    expect(world.harnessCount()).toBe(0);

    const first = world.connect();
    first.send(frames.initialize(1));
    expect(world.harnessCount()).toBe(1);

    // A colleague opens the same sandbox, and their traffic lands on the
    // harness that is already running.
    const second = world.connect();
    second.send(frames.listSessions(2));

    expect(world.harness().receivedMethods()).toEqual([
      "initialize",
      "session/list",
    ]);
    expect(world.harnessCount()).toBe(1);
  });

  /**
   * When the harness dies it takes the sandbox with it, and everyone
   * connected is closed. Someone opening a new tab a moment later knows none
   * of that and just connects.
   *
   * They have to be turned away, and told why. A fresh harness would come up
   * with none of the state the old one held, so the tab would look connected
   * while being somewhere else entirely. Getting the pod back is the
   * controller's job, not the next client's.
   */
  it("should refuse a client that connects after the harness has died, and not restart it", async () => {
    const world = createWorld();
    const first = world.connect();

    world.harness().exit();
    await flushMicrotasks();
    expect(first.isOpen()).toBe(false);

    // The new tab gets a closed socket with a reason, not one that hangs.
    const harnessesBeforeReconnect = world.harnessCount();
    const late = world.connect();

    expect(late.isOpen()).toBe(false);
    expect(late.closes[0]).toMatchObject({
      code: 1011,
      reason: "agent process is not running",
    });
    // Death is a one-way latch: connecting does not spawn a replacement the
    // way it spawned the first one.
    expect(world.harnessCount()).toBe(harnessesBeforeReconnect);
  });

  /**
   * On a first boot the pod answers /healthz before its env exists, so
   * api-server starts relaying and a client can be talking before the harness
   * can usefully be started.
   *
   * Env is read once per spawn, so a harness started in that window has no
   * credentials until something recycles it. The runtime holds the spawn back
   * and keeps what the client sends, then replays it in the order it was sent
   * once env lands. The client never learns it waited.
   */
  it("should wait for env before starting the harness, then replay the client's messages in order", () => {
    const world = createWorld({ envReadyAtBoot: false });
    const client = world.connect();

    client.send(frames.initialize(1));
    client.send(frames.newSession(2));
    client.send(frames.listSessions(3));

    expect(world.harnessStarted()).toBe(false);

    world.runtime.refreshEnv({ force: false });

    expect(world.harnessStarted()).toBe(true);
    expect(world.harness().receivedMethods()).toEqual([
      "initialize",
      "session/new",
      "session/list",
    ]);
  });

  /**
   * That wait cannot be open-ended, because env can fail to arrive at all: a
   * failed `hello` is logged and swallowed, which leaves the pod up and Ready
   * with nothing left that would ever open the gate.
   *
   * So the runtime gives up after a bound and starts anyway. A sandbox with no
   * credentials is degraded, but the client gets an answer instead of a socket
   * that never replies, and if env turns up later a recycle picks it up.
   */
  it("should stop waiting for env rather than leave the client hanging forever", () => {
    vi.useFakeTimers();

    const world = createWorld({
      envReadyAtBoot: false,
      warmStartTimeoutMs: 15_000,
    });
    const client = world.connect();
    client.send(frames.initialize(1));

    expect(world.harnessStarted()).toBe(false);

    // Env never arrives, and the bound runs out.
    vi.advanceTimersByTime(15_000);

    expect(world.harnessStarted()).toBe(true);
    expect(world.harness().receivedMethods()).toEqual(["initialize"]);
    expect(client.isOpen()).toBe(true);
  });
});
