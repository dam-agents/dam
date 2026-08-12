import { describe, it, expect } from "vitest";
import {
  createWorld,
  frames,
  promptTextsOf,
  transcriptOf,
} from "./acp-world.js";

/**
 * Feature: leaving.
 *
 * Nobody says goodbye. A tab closes, a laptop lid drops, a connection just
 * dies — and the conversation, the other people in it, and the work in
 * flight must be exactly as they would have been with the socket still
 * there. Only what belonged to the leaver alone goes with them, and once
 * nothing belongs to anyone, the sandbox lets the conversation go.
 *
 * See `acp-runtime-joining.test.ts` for the way back in; this feature is
 * about what a departure may and may not change.
 */

const SESSION = "sess-shared";

describe("acp-runtime: leaving", () => {
  /**
   * Two people are watching a turn and one of them leaves. The other must
   * notice nothing, and neither must the agent.
   *
   * The harness cannot be trusted with this because it cannot even see it:
   * it writes to one stdout whether three people are watching or none, and
   * never learns that a reader existed, let alone left. A departure is an
   * event on the client side of the relay, and keeping it there — no dropped
   * turn, no closed sockets, no harness restart — is the runtime's job.
   */
  it("should let one client leave without disturbing the others or the harness", () => {
    const world = createWorld();

    // Alice asks, Bob is watching, and the agent is mid-answer.
    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(frames.prompt(2, SESSION, "summarize this repo"));
    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));
    world.harness().emit(frames.agentMessage(SESSION, "it is a monorepo"));

    // Bob's tab closes.
    bob.disconnect();

    // The rest of the turn plays out for Alice as if he had never left.
    world.harness().emit(frames.agentMessage(SESSION, "with three packages"));
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    expect(alice.isOpen()).toBe(true);
    expect(alice.closes).toEqual([]);
    expect(alice.reply(2)?.result).toEqual({ stopReason: "end_turn" });
    expect(transcriptOf(alice)).toEqual([
      `${SESSION}: it is a monorepo`,
      `${SESSION}: with three packages`,
    ]);

    // And the machinery is untouched: the harness was neither stopped nor
    // told to shed the session — Alice is still in it.
    expect(world.harness().killed()).toBe(false);
    expect(world.harness().received("session/close")).toEqual([]);
  });

  /**
   * The person whose turn is running disconnects while the agent is
   * mid-answer. The turn is not theirs to take down with them: it belongs to
   * the conversation, which others may be watching and more messages are
   * queued behind.
   *
   * Tying the turn to the socket that started it would let a flaky wifi
   * cancel work minutes in. So the runtime lets the turn run, drops the
   * answer it can no longer deliver, and — the part only it can do — still
   * treats the turn's end as the queue's cue: the harness learns turns are
   * over by nothing but its own response arriving, so with the asker gone,
   * only the runtime is left to notice the slot freed and send in the next
   * question.
   */
  it("should finish the turn and run the next queued message when a client disconnects mid-turn", () => {
    const world = createWorld();

    // Alice asks, and while the agent is working Bob queues the next
    // question behind the running turn.
    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(frames.prompt(2, SESSION, "refactor the parser"));
    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));
    bob.send(frames.prompt(2, SESSION, "then run the tests"));

    // Alice leaves with her turn still running.
    alice.disconnect();

    // The agent never hears about it — no cancel — and finishes the turn on
    // its own terms.
    world.harness().emit(frames.agentMessage(SESSION, "done, parser shrank"));
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    // The moment the slot freed, Bob's question went in, exactly as it
    // would have with Alice still there.
    expect(world.harness().received("session/cancel")).toEqual([]);
    expect(promptTextsOf(world.harness())).toEqual([
      "refactor the parser",
      "then run the tests",
    ]);

    // And Bob's turn is a real one: the agent answers it, and the answer
    // comes back to him.
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });
    expect(bob.reply(2)?.result).toEqual({ stopReason: "end_turn" });
  });
});
