import { describe, it, expect } from "vitest";
import {
  createSessionMetadata,
  createWorld,
  frames,
  promptTextsOf,
} from "./acp-world.js";

/**
 * Feature: the machine client.
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
  /**
   * A schedule fires in the middle of the night. The driver connects, sends
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

    // The driver's whole visit: connect, create, fire, hang up.
    const machine = world.connect({ viewer: false });
    machine.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    machine.send(frames.prompt(2, SESSION, "run the nightly dependency audit"));
    machine.disconnect();

    // With nobody connected the pod still reports itself busy — hibernating
    // now would kill the very work the schedule exists to run.
    expect(world.runtime.status().idle).toBe(false);

    // The agent works into the empty room and finishes on its own terms.
    world.harness().emit(frames.agentMessage(SESSION, "two majors, one CVE"));
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    // The turn was never cut short: the prompt reached the agent, nothing
    // cancelled it, and the harness outlives it. Only now may the pod idle.
    expect(promptTextsOf(world.harness())).toEqual([
      "run the nightly dependency audit",
    ]);
    expect(world.harness().received("session/cancel")).toEqual([]);
    expect(world.harness().killed()).toBe(false);
    expect(world.runtime.status().idle).toBe(true);
  });

  /**
   * Unread is a promise to a person: something happened here that nobody has
   * looked at. The machine client sends the very frames a person would, and
   * the runtime is the only party that knows which channels are eyes and
   * which are cron. If machine activity counted as seen, every scheduled run
   * would mark its own work read at birth, and the badge would stay dark on
   * exactly the conversations nobody has opened.
   */
  it("should not mark a scheduled turn's conversation as read", () => {
    const meta = createSessionMetadata();
    const world = createWorld({ sessionMetadata: meta.store });

    // A scheduled run, start to finish, with no human anywhere.
    const machine = world.connect({ viewer: false });
    machine.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    machine.send(frames.prompt(2, SESSION, "triage the new issues"));
    machine.disconnect();
    world.harness().emit(frames.agentMessage(SESSION, "labelled three"));
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    // The finished turn is activity nobody has seen.
    expect(meta.unread(SESSION)).toBe(true);

    // And it is a person opening the conversation that reads it — the badge
    // answers to eyes, not to traffic.
    const human = world.connect();
    human.send(frames.loadSession(1, SESSION));
    expect(meta.unread(SESSION)).toBe(false);
  });
});
