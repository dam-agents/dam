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

  /**
   * A queued message has not reached the harness yet; it exists only inside
   * the runtime. If its sender leaves before its turn comes, running it
   * anyway would start work whose asker can never see it, answer its
   * permission prompts, or read its result — so it goes with them. But only
   * theirs: the queue is the conversation's, not the leaver's, and the
   * neighbour behind them in line did nothing wrong.
   *
   * Only the runtime can make that cut. The harness has never seen either
   * message, and each client knows only its own — the runtime alone knows
   * whose message is whose.
   */
  it("should drop a leaver's queued messages but nobody else's", () => {
    const world = createWorld();

    // Alice's turn is running, and two questions wait behind it: first
    // Bob's, then Carol's.
    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(frames.prompt(2, SESSION, "keep the build green"));
    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));
    bob.send(frames.prompt(2, SESSION, "also update the deps"));
    const carol = world.connect();
    carol.send(frames.loadSession(1, SESSION));
    carol.send(frames.prompt(2, SESSION, "and tag a release"));

    // Bob leaves before his question ever reached the agent.
    bob.disconnect();

    // The running turn ends, and the queue drains past the hole he left.
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    // The agent was asked exactly two things, and Bob's was never one of
    // them. Carol's survived his departure untouched and got its answer.
    expect(promptTextsOf(world.harness())).toEqual([
      "keep the build green",
      "and tag a release",
    ]);
    expect(carol.reply(2)?.result).toEqual({ stopReason: "end_turn" });
  });

  /**
   * The last person closes the tab on a finished conversation. Every open
   * session pins a CLI subprocess of roughly 300MB inside the harness, so a
   * sandbox that kept every visited conversation live would bloat until the
   * pod died — and the harness will not save itself, because it has no idea
   * whether anyone is reading. Counting readers is the runtime's job, and
   * zero readers with nothing running means letting the session go.
   *
   * "Released" is proven by what the harness received, and deliberately says
   * nothing about how the runtime decided — a scenario that mentioned timers
   * would break during the #3108 refactor and lose the safety net it exists
   * to provide.
   */
  it("should release the session's resources when the last client leaves and nothing is running", () => {
    const world = createWorld();

    // Alice has a complete conversation: asked, answered, turn over.
    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(frames.prompt(2, SESSION, "tidy the README"));
    world.harness().emit(frames.agentMessage(SESSION, "done"));
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    // While she is looking at it, the session is hers and stays live.
    expect(world.harness().received("session/close")).toEqual([]);

    // She closes the tab, leaving the sandbox empty with nothing running.
    alice.disconnect();

    // The harness is told to let the conversation go — that is the
    // subprocess behind it being freed. The harness itself stays up for the
    // next visitor: releasing a conversation is not stopping the sandbox.
    expect(
      world
        .harness()
        .received("session/close")
        .map((frame) => frame.params),
    ).toEqual([{ sessionId: SESSION }]);
    expect(world.harness().killed()).toBe(false);
  });
});
