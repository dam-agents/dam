import { describe, it, expect, afterEach, vi } from "vitest";
import { createWorld, frames } from "./acp-world.js";

/**
 * TEST_OVERVIEW: applying an env change to a running sandbox.
 *
 * The harness reads env once, at spawn. A credential granted or rotated
 * later reaches the agent only when the harness process is recycled. The
 * runtime must do that swap without cutting off anyone's work: right away
 * when the sandbox is idle, after the running turn ends when it is not,
 * and — when the caller forces it — after a bounded grace period even if
 * work never drains, so a revoked credential cannot stay usable forever.
 */

describe("acp-runtime: env changes", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * TEST_SCENARIO: An env change lands while the sandbox is idle. The harness
   * must be swapped before the next prompt, or the agent would keep using
   * the old credentials. Anyone connected is closed with the recycle reason,
   * and the next client to connect gets a fresh process.
   */
  it("should recycle the harness right away when nothing is running", () => {
    const world = createWorld();
    const client = world.connect();
    client.send(frames.initialize(1));
    const before = world.harness();

    world.runtime.refreshEnv({ force: false });

    expect(before.killed()).toBe(true);
    expect(client.closes[0]).toMatchObject({
      code: 1011,
      reason: "agent recycled for env change",
    });

    world.connect();
    expect(world.harnessCount()).toBe(2);
  });

  /**
   * TEST_SCENARIO: An env change lands in the middle of a turn. Killing the
   * harness now would cut the user's answer off for a change that can wait.
   * The recycle is deferred: the sender still gets the full reply, and the
   * swap happens the moment the turn ends.
   */
  it("should let the running turn finish and deliver its answer before recycling", () => {
    const world = createWorld();
    const client = world.connect();
    client.send(frames.initialize(1));
    client.send(frames.newSession(2));
    world.harness().replyTo("session/new", { sessionId: "s1" });
    client.send(frames.prompt(3, "s1", "rotate the deploy key"));

    world.runtime.refreshEnv({ force: false });

    expect(world.harness().killed()).toBe(false);
    expect(client.isOpen()).toBe(true);

    world.harness().replyToSession("session/prompt", "s1");

    expect(client.reply(3)).toBeDefined();
    expect(world.harness().killed()).toBe(true);
    expect(client.closes[0]).toMatchObject({
      code: 1011,
      reason: "agent recycled for env change",
    });
  });

  /**
   * TEST_SCENARIO: An env change lands mid-turn and the turn never ends — a
   * stuck tool call, an endless loop. Without a bound, a revoked credential
   * would stay live for as long as the turn runs. A forced refresh waits a
   * grace period for the work to drain, then recycles anyway and tells the
   * connected clients why.
   */
  it("should force the recycle after the grace period when work never drains", () => {
    vi.useFakeTimers();

    const world = createWorld({ envForceRecycleMs: 60_000 });
    const client = world.connect();
    client.send(frames.initialize(1));
    client.send(frames.newSession(2));
    world.harness().replyTo("session/new", { sessionId: "s1" });
    client.send(frames.prompt(3, "s1", "run forever"));

    world.runtime.refreshEnv({ force: true });

    expect(world.harness().killed()).toBe(false);

    vi.advanceTimersByTime(60_000);

    expect(world.harness().killed()).toBe(true);
    expect(client.closes[0]).toMatchObject({
      code: 1011,
      reason: "agent recycled for env change",
    });
  });
});
