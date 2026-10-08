import { describe, it, expect } from "vitest";
import {
  createWorld,
  frames,
  promptTextsOf,
  type Client,
  type World,
} from "./acp-world.js";

/**
 * TEST_OVERVIEW: a Session the harness lost is loaded back on the next prompt.
 *
 * Some harnesses run each Session in a process of their own under the ACP
 * adapter — claude-agent-acp runs a `claude` process per Session. When that
 * process dies (a memory kill, a crash), the adapter keeps running, fails the
 * turn with "The Claude Agent process exited unexpectedly", and forgets the
 * Session: every later session/prompt is answered "Session not found". The
 * harness process never exits, so nothing a harness exit or a pod restart
 * would do happens. The runtime instead reads a prompt error that says the
 * harness lost the Session, and treats the Session as harness-cold: the next
 * prompt first re-attaches it — session/resume or session/load — and is
 * forwarded only once the harness answers, as after a pod restart.
 */

const SESSION = "sess-lost";

function openSession(world: World): Client {
  const bob = world.connect();
  bob.send(frames.newSession(1));
  world.harness().replyTo("session/new", { sessionId: SESSION });
  return bob;
}

function failLastPrompt(world: World, error: object): void {
  const prompts = world.harness().received("session/prompt");
  const last = prompts[prompts.length - 1];
  world.harness().emit({ jsonrpc: "2.0", id: last?.id, error });
}

const PROCESS_DIED = {
  code: -32603,
  message:
    "Internal error: The Claude Agent process exited unexpectedly. Please start a new session.",
};

const SESSION_NOT_FOUND = {
  code: -32603,
  message: "Internal error",
  data: { details: "Session not found" },
};

describe("acp-runtime: a Session the harness lost", () => {
  /**
   * TEST_SCENARIO: The memory reaper or a crash kills the Session's own
   * process mid-turn. The turn fails, but the user's next message must load
   * the Session back into the harness before it is sent, instead of meeting
   * "Session not found" until the pod restarts.
   */
  it("should load the Session back before the next prompt after its process died", () => {
    const world = createWorld();
    const bob = openSession(world);

    bob.send(frames.prompt(2, SESSION, "first"));
    failLastPrompt(world, PROCESS_DIED);
    expect(bob.reply(2)).toMatchObject({ error: PROCESS_DIED });

    bob.send(frames.prompt(3, SESSION, "second"));
    expect(promptTextsOf(world.harness())).toEqual(["first"]);
    expect(world.harness().received("session/load")).toHaveLength(1);

    world.harness().replyToSession("session/load", SESSION, {
      sessionId: SESSION,
    });
    expect(promptTextsOf(world.harness())).toEqual(["first", "second"]);
  });

  /**
   * TEST_SCENARIO: The process can also die between turns, and the adapter
   * then answers the next prompt "Session not found". That answer must make
   * the Session harness-cold too, so the message after it gets through.
   */
  it("should load the Session back after the harness answers Session not found", () => {
    const world = createWorld();
    const bob = openSession(world);

    bob.send(frames.prompt(2, SESSION, "first"));
    failLastPrompt(world, SESSION_NOT_FOUND);

    bob.send(frames.prompt(3, SESSION, "second"));
    expect(world.harness().received("session/load")).toHaveLength(1);
    world.harness().replyToSession("session/load", SESSION, {
      sessionId: SESSION,
    });
    expect(promptTextsOf(world.harness())).toEqual(["first", "second"]);
  });

  /**
   * TEST_SCENARIO: A prompt queued behind the turn that failed has no submit
   * of its own left to start the re-attach. The re-attach must start when the
   * failed turn ends, or the queued prompt waits forever.
   */
  it("should re-attach at once for a prompt queued behind the failed turn", () => {
    const world = createWorld();
    const bob = openSession(world);

    bob.send(frames.prompt(2, SESSION, "first"));
    bob.send(frames.prompt(3, SESSION, "queued"));
    failLastPrompt(world, PROCESS_DIED);

    expect(world.harness().received("session/load")).toHaveLength(1);
    expect(promptTextsOf(world.harness())).toEqual(["first"]);
    world.harness().replyToSession("session/load", SESSION, {
      sessionId: SESSION,
    });
    expect(promptTextsOf(world.harness())).toEqual(["first", "queued"]);
  });

  /**
   * TEST_SCENARIO: An ordinary turn error leaves the harness holding the
   * Session, so the next prompt must go straight through without a load.
   */
  it("should not re-attach after an error that leaves the Session in the harness", () => {
    const world = createWorld();
    const bob = openSession(world);

    bob.send(frames.prompt(2, SESSION, "first"));
    failLastPrompt(world, {
      code: -32603,
      message: "Internal error: overloaded",
    });

    bob.send(frames.prompt(3, SESSION, "second"));
    expect(world.harness().received("session/load")).toEqual([]);
    expect(promptTextsOf(world.harness())).toEqual(["first", "second"]);
  });
});
