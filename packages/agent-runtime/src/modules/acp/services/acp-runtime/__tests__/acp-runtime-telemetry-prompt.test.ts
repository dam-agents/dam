import { describe, expect, it } from "vitest";
import { createWorld, frames } from "./acp-world.js";

/**
 * TEST_OVERVIEW: the harness names each prompt for its own telemetry and hands
 * that name to the runtime from a hook while the turn still runs. The
 * end-of-turn notification carries it, so the reply in the transcript can be
 * joined to the telemetry the turn produced by identity rather than by clock.
 */

const SESSION = "sess-telemetry";

function endedWith(
  client: ReturnType<ReturnType<typeof createWorld>["connect"]>,
) {
  return client
    .saw("platform/turnEnded")
    .map((frame) => (frame as { params: Record<string, unknown> }).params);
}

describe("acp-runtime: the harness's prompt id on turnEnded", () => {
  /**
   * TEST_SCENARIO: The harness reports its id for the running turn before it
   * answers the prompt. The turn's end names that id, for everyone watching.
   */
  it("should name the harness's prompt id on the turn it was reported during", () => {
    const world = createWorld();

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(frames.prompt(2, SESSION, "summarize this repo"));
    world.runtime.recordTelemetryPromptId(SESSION, "otel-prompt-1");
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    expect(endedWith(alice)).toEqual([
      expect.objectContaining({
        sessionId: SESSION,
        stopReason: "end_turn",
        telemetryPromptId: "otel-prompt-1",
      }),
    ]);
  });

  /**
   * TEST_SCENARIO: A turn that got no report must not inherit the previous
   * turn's id — a wrong join is worse than none.
   */
  it("should not carry one turn's id onto the next", () => {
    const world = createWorld();

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(frames.prompt(2, SESSION, "first"));
    world.runtime.recordTelemetryPromptId(SESSION, "otel-prompt-1");
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });
    alice.send(frames.prompt(3, SESSION, "second"));
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    const [first, second] = endedWith(alice);
    expect(first?.telemetryPromptId).toBe("otel-prompt-1");
    expect(second).not.toHaveProperty("telemetryPromptId");
  });

  /**
   * TEST_SCENARIO: A report that lands with no turn in flight names nothing the
   * runtime can attribute, so it is dropped rather than parked for whatever
   * turn comes next.
   */
  it("should ignore a report for a session with no turn in flight", () => {
    const world = createWorld();

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    world.runtime.recordTelemetryPromptId(SESSION, "stale");
    alice.send(frames.prompt(2, SESSION, "hello"));
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    expect(endedWith(alice)[0]).not.toHaveProperty("telemetryPromptId");
  });

  /**
   * TEST_SCENARIO: The hook can lose its race with the turn's end — the report
   * lands after the turn closed, when no turn is in flight. It carries no turn
   * identity, so the runtime drops it rather than guess it onto a bystander;
   * the reply is keyed by position on the next session load instead.
   */
  it("should drop a report that lands with no turn to attribute it to", () => {
    const world = createWorld();

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(frames.prompt(2, SESSION, "summarize this repo"));
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });
    world.runtime.recordTelemetryPromptId(SESSION, "otel-late");

    expect(endedWith(alice)[0]).not.toHaveProperty("telemetryPromptId");
    expect(alice.saw("platform/turnTelemetry")).toEqual([]);
  });
});
