import { describe, it, expect, afterEach, vi } from "vitest";
import {
  createSessionMetadata,
  createWorld,
  frames,
  promptTextsOf,
  IDLE_REAP_DELAY_MS,
} from "./acp-world.js";

/**
 * TEST_OVERVIEW: the machine client.
 *
 * Not every turn is typed by a person. Schedules and triggers drive the
 * sandbox through the same door the UI uses — an in-process channel that
 * connects, fires one prompt, and hangs up without waiting for the answer.
 * Everything after that happens in an empty room, and the conversation must
 * come out the other side exactly as a watched one would, except for the
 * one thing only eyes can do: reading it.
 */

const SESSION = "sess-scheduled";

describe("acp-runtime: the machine client", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * TEST_SCENARIO: A schedule fires in the middle of the night. The driver connects, sends
   * the prompt, and is gone before the first token comes back, so the turn
   * belongs to nobody the whole way through.
   *
   * The threat is not the harness, which writes to its stdout whether anyone
   * reads it or not. It is the runtime itself: as the only party that knows
   * the room is empty, it is the only one positioned to decide an unwatched
   * turn is not worth having — cancel it with its departed sender, or report
   * the pod idle and let the controller hibernate the work mid-flight. A
   * turn with no audience is still a turn.
   */
  it("should run a scheduled turn to completion with no human connected", () => {
    const world = createWorld();

    const machine = world.connect({ viewer: false });
    machine.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    machine.send(frames.prompt(2, SESSION, "run the nightly dependency audit"));
    machine.disconnect();

    expect(world.runtime.status().idle).toBe(false);

    world.harness().emit(frames.agentMessage(SESSION, "two majors, one CVE"));
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    expect(promptTextsOf(world.harness())).toEqual([
      "run the nightly dependency audit",
    ]);
    expect(world.harness().received("session/cancel")).toEqual([]);
    expect(world.harness().killed()).toBe(false);
    expect(world.runtime.status().idle).toBe(true);
  });

  /**
   * TEST_SCENARIO: Unread is a promise to a person: something happened here that nobody has
   * looked at. The machine client sends the very frames a person would, and
   * the runtime is the only party that knows which channels are eyes and
   * which are cron. If machine activity counted as seen, every scheduled run
   * would mark its own work read at birth, and the badge would stay dark on
   * exactly the conversations nobody has opened.
   */
  it("should not mark a scheduled turn's conversation as read", () => {
    const meta = createSessionMetadata();
    const world = createWorld({ sessionMetadata: meta.store });

    const machine = world.connect({ viewer: false });
    machine.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    machine.send(frames.prompt(2, SESSION, "triage the new issues"));
    machine.disconnect();
    world.harness().emit(frames.agentMessage(SESSION, "labelled three"));
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    expect(meta.unread(SESSION)).toBe(true);

    const human = world.connect();
    human.send(frames.loadSession(1, SESSION));
    expect(meta.unread(SESSION)).toBe(false);
  });

  /**
   * TEST_SCENARIO: Every live session pins a CLI subprocess of roughly 300MB, and every
   * other release in this suite is set off by a departure — but a scheduled
   * session's only visitor left before the turn began, so no disconnect is
   * ever coming. The turn's own end is the one moment left, and only the
   * runtime is there for it: the harness would hold the session forever, and
   * a schedule that leaked one subprocess per night would bloat the pod
   * until it died.
   */
  it("should release a scheduled turn's session when it finishes", () => {
    vi.useFakeTimers();
    const world = createWorld();

    const machine = world.connect({ viewer: false });
    machine.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    machine.send(frames.prompt(2, SESSION, "rotate the credentials"));
    machine.disconnect();

    vi.advanceTimersByTime(IDLE_REAP_DELAY_MS);
    expect(world.harness().received("session/close")).toEqual([]);

    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    vi.advanceTimersByTime(IDLE_REAP_DELAY_MS);
    expect(
      world
        .harness()
        .received("session/close")
        .map((frame) => frame.params),
    ).toEqual([{ sessionId: SESSION }]);
    expect(world.harness().killed()).toBe(false);
  });
});
