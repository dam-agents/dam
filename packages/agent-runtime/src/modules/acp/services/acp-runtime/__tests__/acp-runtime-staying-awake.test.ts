import { describe, it, expect, afterEach, vi } from "vitest";
import { createBackgroundWorkRegistry } from "../../background-work-registry.js";
import { createWorld, frames, IDLE_REAP_DELAY_MS } from "./acp-world.js";

/**
 * Feature: staying awake.
 *
 * The controller asks one question — `status()` — to decide whether a pod
 * can hibernate. Anything the answer misses gets killed: a running turn, a
 * queued question, an unanswered ask from the agent, a background job. Only
 * the runtime can see these, so these scenarios pin what "busy" means and
 * the full shape of the answer — a pod that stays awake must be able to say
 * why.
 */

const SESSION = "sess-awake";

/** Let the runtime's `exited` promise handler run. */
const flushMicrotasks = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

describe("acp-runtime: staying awake", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * The active-prompt hold is already pinned in the machine-client feature
   * (a scheduled turn keeps the pod busy with nobody connected). This file
   * starts one step later, with the holds that exist next to a turn or
   * after it.
   *
   * A queued question exists only inside the runtime: the harness has never
   * seen it. If "busy" only counted what the harness is doing, the pod
   * would look idle between two turns while it still owes an answer — and a
   * hibernation at that moment would lose the queue.
   */
  it("should stay busy across the turn boundary while a question is still queued", () => {
    const world = createWorld();

    // Alice's turn is running and Bob's question waits behind it.
    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(frames.prompt(2, SESSION, "refactor the parser"));
    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));
    bob.send(frames.prompt(2, SESSION, "then run the tests"));

    expect(world.runtime.status()).toEqual({ idle: false, backgroundWork: [] });

    // The first turn ends. The conversation is not over — Bob's question
    // still needs an answer — and the pod must not look idle in between.
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });
    expect(world.runtime.status()).toEqual({ idle: false, backgroundWork: [] });

    // Only when the queue is empty is there nothing left to protect.
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });
    expect(world.runtime.status()).toEqual({ idle: true, backgroundWork: [] });
  });

  /**
   * The agent asked for permission and the person who could answer is gone.
   * Anyone who opens the conversation later can still answer, so the pod
   * must stay up and the session must stay open for them. Sleeping now, or
   * closing the session because nobody is connected, would silently throw
   * away a decision someone was asked to make.
   */
  it("should stay awake on an unanswered question from the agent until someone answers it", () => {
    vi.useFakeTimers();
    const world = createWorld();

    // Alice asks, the agent asks for permission, and Alice's connection
    // dies before she answers. The turn then ends with nobody connected.
    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(frames.prompt(2, SESSION, "delete the stale branches"));
    world.harness().emit(frames.requestPermission(900, SESSION, "git"));
    alice.disconnect();
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    // Nobody is connected and no turn is running, yet the pod is not idle
    // and the session is not released — even once the quiescence window
    // that follows an idle turn has passed: the question is still open.
    vi.advanceTimersByTime(IDLE_REAP_DELAY_MS);
    expect(world.runtime.status()).toEqual({ idle: false, backgroundWork: [] });
    expect(world.harness().received("session/close")).toEqual([]);

    // Bob opens the conversation, sees the waiting question, and answers.
    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));
    expect(bob.saw("session/request_permission")).toHaveLength(1);
    bob.send(frames.permissionAnswer(900));

    // The agent got its answer. With the question resolved, the pod can go
    // idle.
    expect(world.harness().answersTo(900)).toHaveLength(1);
    expect(world.runtime.status()).toEqual({ idle: true, backgroundWork: [] });
  });

  /**
   * A turn can end with work still running: the agent started a job in the
   * background and answered before the job finished. The harness reports
   * that work to the pod (the background-work contract), and only the
   * runtime can act on the report — closing the session would kill the
   * subprocess that supervises the job, and reporting idle would let the
   * controller hibernate it. The status payload lists what is held and why,
   * so a pod that is unexpectedly awake can be explained. When the work
   * ends, both holds must let go on their own: nobody is connected, so no
   * disconnect will ever trigger the release.
   */
  it("should hold the pod awake and the session open for background work, and release both when it ends", () => {
    vi.useFakeTimers();
    const backgroundWork = createBackgroundWorkRegistry();
    const world = createWorld({
      backgroundWork,
      backgroundWorkRecheckMs: 15_000,
    });

    // Alice starts a soak test. The session reports the job it left running
    // (this is what the pod's report endpoint does on its behalf). The turn
    // ends and Alice leaves.
    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(frames.prompt(2, SESSION, "start the soak test and let it run"));
    backgroundWork.report(SESSION, [
      { id: "job-1", description: "overnight soak", command: "k6 run soak.js" },
    ]);
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });
    alice.disconnect();

    // The pod says exactly why it is awake, and the session that owns the
    // work stays open even though nobody is connected.
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

    // Hours can pass; as long as the work runs, nothing changes.
    vi.advanceTimersByTime(15_000);
    expect(world.harness().received("session/close")).toEqual([]);

    // The job finishes and the session reports it has nothing running.
    backgroundWork.report(SESSION, []);

    // The pod can go idle, and the session is released without anyone ever
    // reconnecting. The harness itself stays up: releasing a conversation
    // is not stopping the sandbox.
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

  /**
   * A hold protects work running inside the harness's process tree, so when
   * the harness dies the work dies with it. A hold that survived would be
   * the worst failure this feature can have: an empty pod kept awake
   * forever, with a status naming a job that no longer exists.
   */
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

    // Whatever was running died with the harness. Nothing is left to hold
    // for, and the pod must be free to reclaim.
    expect(world.runtime.status()).toEqual({ idle: true, backgroundWork: [] });
  });

  /**
   * A hold is advisory, never final: a reporter may die without ever saying
   * "done", and the contract accepts that because a hard teardown reclaims
   * the pod anyway. Resetting the session is that teardown — it kills the
   * session's subprocess and the work under it, so the hold must go too,
   * instead of keeping an empty pod awake for a dead job.
   */
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

    // The session was closed on the agent's side too, and no leftover hold
    // keeps the pod awake.
    expect(
      world
        .harness()
        .received("session/close")
        .map((frame) => frame.params),
    ).toEqual([{ sessionId: SESSION }]);
    expect(world.runtime.status()).toEqual({ idle: true, backgroundWork: [] });
  });
});
