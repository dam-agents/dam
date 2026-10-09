import { describe, it, expect, afterEach, vi } from "vitest";
import { createBackgroundWorkRegistry } from "../../background-work-registry.js";
import { createWorld, frames } from "./acp-world.js";

/**
 * TEST_OVERVIEW: a settings change waiting for kept background tasks.
 *
 * A forced recycle for an env or config change is held back while a kept
 * Harness Task runs, because the recycle would kill it. The runtime reports
 * the waiting change, so the user can choose to restart now. To make that
 * choice the user must know everything a restart now stops: every Harness
 * Task of the session, kept or not, and every running turn.
 */

const SESSION = "sess-restart";
const GRACE_MS = 60_000;

const devServer = {
  id: "task-dev",
  description: "dev server",
  command: "pnpm dev",
};
const logTail = { id: "task-tail", description: "log tail", command: "tail" };

describe("acp-runtime: pending restart", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * TEST_SCENARIO: The agent runs a kept dev server and an unkept log tail,
   * and a turn is still running, when a connection changes. After the grace
   * period the recycle still waits, because the dev server is kept. The
   * report says one kept task blocks the restart, and a restart now stops
   * both tasks and the turn. When the turn ends, watchers hear about it and
   * the turn is no longer counted. Applying the change recycles the harness.
   */
  it("should report what a restart now stops while a kept task holds it back", () => {
    vi.useFakeTimers();
    const backgroundWork = createBackgroundWorkRegistry({
      isKept: (_sessionId, item) => item.id === devServer.id,
    });
    const world = createWorld({ backgroundWork, envForceRecycleMs: GRACE_MS });
    let notices = 0;
    world.runtime.onPendingRestartChange(() => notices++);

    const client = world.connect();
    client.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    client.send(frames.prompt(2, SESSION, "start the dev server"));
    backgroundWork.report(SESSION, [devServer, logTail]);

    world.runtime.refreshEnv({ force: true });
    vi.advanceTimersByTime(GRACE_MS);

    expect(world.harness().killed()).toBe(false);
    expect(world.runtime.pendingRestart()).toMatchObject({
      reason: "env-recycle",
      blockingTasks: 1,
      stops: { tasks: 2, turns: 1 },
    });

    const before = notices;
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    expect(notices).toBeGreaterThan(before);
    expect(world.runtime.pendingRestart()).toMatchObject({
      blockingTasks: 1,
      stops: { tasks: 2, turns: 0 },
    });

    expect(world.runtime.applyPendingRestart()).toBe(true);
    expect(world.harness().killed()).toBe(true);
    expect(world.runtime.pendingRestart()).toBeNull();
  });
});
