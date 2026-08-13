import { describe, it, expect, afterEach, vi } from "vitest";
import { createBackgroundWorkRegistry } from "../../background-work-registry.js";
import { createWorld, frames, IDLE_REAP_DELAY_MS } from "./acp-world.js";

/**
 * TEST_OVERVIEW: staying awake.
 *
 * The controller asks one question — `status()` — to decide whether a pod
 * can hibernate. Anything the answer misses gets killed: a running turn, a
 * queued question, an unanswered ask from the agent, a background job. Only
 * the runtime can see these, so these scenarios pin what "busy" means and
 * the full shape of the answer — a pod that stays awake must be able to say
 * why.
 */

const SESSION = "sess-awake";

const flushMicrotasks = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

describe("acp-runtime: staying awake", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("should stay busy across the turn boundary while a question is still queued", () => {
    const world = createWorld();

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(frames.prompt(2, SESSION, "refactor the parser"));
    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));
    bob.send(frames.prompt(2, SESSION, "then run the tests"));

    expect(world.runtime.status()).toEqual({ idle: false, backgroundWork: [] });

    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });
    expect(world.runtime.status()).toEqual({ idle: false, backgroundWork: [] });

    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });
    expect(world.runtime.status()).toEqual({ idle: true, backgroundWork: [] });
  });

  it("should stay awake on an unanswered question from the agent until someone answers it", () => {
    vi.useFakeTimers();
    const world = createWorld();

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(frames.prompt(2, SESSION, "delete the stale branches"));
    world.harness().emit(frames.requestPermission(900, SESSION, "git"));
    alice.disconnect();
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    vi.advanceTimersByTime(IDLE_REAP_DELAY_MS);
    expect(world.runtime.status()).toEqual({ idle: false, backgroundWork: [] });
    expect(world.harness().received("session/close")).toEqual([]);

    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));
    expect(bob.saw("session/request_permission")).toHaveLength(1);
    bob.send(frames.permissionAnswer(900));

    expect(world.harness().answersTo(900)).toHaveLength(1);
    expect(world.runtime.status()).toEqual({ idle: true, backgroundWork: [] });
  });

  it("should hold the pod awake and the session open for background work, and release both when it ends", () => {
    vi.useFakeTimers();
    const backgroundWork = createBackgroundWorkRegistry();
    const world = createWorld({
      backgroundWork,
      backgroundWorkRecheckMs: 15_000,
    });

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(frames.prompt(2, SESSION, "start the soak test and let it run"));
    backgroundWork.report(SESSION, [
      { id: "job-1", description: "overnight soak", command: "k6 run soak.js" },
    ]);
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });
    alice.disconnect();

    expect(world.runtime.status()).toEqual({
      idle: false,
      backgroundWork: [
        {
          sessionId: SESSION,
          items: [
            {
              id: "job-1",
              description: "overnight soak",
              command: "k6 run soak.js",
            },
          ],
        },
      ],
    });
    expect(world.harness().received("session/close")).toEqual([]);

    vi.advanceTimersByTime(15_000);
    expect(world.harness().received("session/close")).toEqual([]);

    backgroundWork.report(SESSION, []);

    expect(world.runtime.status()).toEqual({ idle: true, backgroundWork: [] });
    vi.advanceTimersByTime(15_000);
    expect(
      world
        .harness()
        .received("session/close")
        .map((frame) => frame.params),
    ).toEqual([{ sessionId: SESSION }]);
    expect(world.harness().killed()).toBe(false);
  });

  it("should drop every background hold when the harness dies", async () => {
    const backgroundWork = createBackgroundWorkRegistry();
    const world = createWorld({ backgroundWork });

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(frames.prompt(2, SESSION, "start the dev server"));
    backgroundWork.report(SESSION, [{ id: "dev", command: "pnpm dev" }]);
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    world.harness().exit();
    await flushMicrotasks();

    expect(world.runtime.status()).toEqual({ idle: true, backgroundWork: [] });
  });

  it("should let a session reset take its background hold down with it", () => {
    const backgroundWork = createBackgroundWorkRegistry();
    const world = createWorld({ backgroundWork });

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(frames.prompt(2, SESSION, "start the flaky migration"));
    backgroundWork.report(SESSION, [
      { id: "mig-1", description: "schema migration" },
    ]);
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    world.runtime.resetSession(SESSION);

    expect(
      world
        .harness()
        .received("session/close")
        .map((frame) => frame.params),
    ).toEqual([{ sessionId: SESSION }]);
    expect(world.runtime.status()).toEqual({ idle: true, backgroundWork: [] });
  });
});
