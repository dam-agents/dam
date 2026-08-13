import { describe, it, expect, afterEach, vi } from "vitest";
import {
  createWorld,
  frames,
  promptTextsOf,
  transcriptOf,
  IDLE_REAP_DELAY_MS,
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
  afterEach(() => {
    vi.useRealTimers();
  });

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
    vi.useFakeTimers();
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

    // And the machinery is untouched: even well past the quiescence window
    // that follows any departure, the harness was neither stopped nor told
    // to shed the session — Alice is still in it.
    vi.advanceTimersByTime(IDLE_REAP_DELAY_MS);
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
   * Not on the spot, though: the release waits out a short quiescence
   * window first, so a turn's trailing work can finish and a tab that
   * reopens right away finds its subprocess still warm. "Released" is
   * proven by what the harness received; the window is the production
   * value, and how the runtime keeps it (per-session timers today, one
   * loop after #3108) is deliberately not pinned.
   */
  it("should release the session's resources when the last client leaves and nothing is running", () => {
    vi.useFakeTimers();
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
    // The departure alone releases nothing — she may be back in a second.
    alice.disconnect();
    expect(world.harness().received("session/close")).toEqual([]);

    // The window passes with nobody back. Now the harness is told to let
    // the conversation go — that is the subprocess behind it being freed.
    // The harness itself stays up for the next visitor: releasing a
    // conversation is not stopping the sandbox.
    vi.advanceTimersByTime(IDLE_REAP_DELAY_MS);
    expect(
      world
        .harness()
        .received("session/close")
        .map((frame) => frame.params),
    ).toEqual([{ sessionId: SESSION }]);
    expect(world.harness().killed()).toBe(false);
  });

  /**
   * The other half of the quiescence window: someone closes the tab and
   * reopens it moments later. Reloads, laptop sleep, a flaky proxy — brief
   * disconnects are everyday events, and paying a full subprocess teardown
   * and cold respawn for each one is exactly what the window exists to
   * avoid. A departure followed by a quick return must leave no trace: the
   * session is never released, and the conversation answers from memory as
   * if the tab had never closed.
   */
  it("should keep the session warm when the last client comes right back", () => {
    vi.useFakeTimers();
    const world = createWorld();

    // A finished conversation, and its only reader closes the tab.
    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(frames.prompt(2, SESSION, "tidy the README"));
    world.harness().emit(frames.agentMessage(SESSION, "done"));
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });
    alice.disconnect();

    // She is back before the window ends.
    const aliceAgain = world.connect();
    aliceAgain.send(frames.loadSession(1, SESSION));

    // Her return cancelled the release: however long she now stays, the
    // session is never let go, and her reload was answered with the
    // conversation intact — no cold rebuild.
    vi.advanceTimersByTime(IDLE_REAP_DELAY_MS * 3);
    expect(world.harness().received("session/close")).toEqual([]);
    expect(aliceAgain.reply(1)).toBeDefined();
    expect(transcriptOf(aliceAgain)).toEqual([
      `${SESSION}: tidy the README`,
      `${SESSION}: done`,
    ]);

    // Leaving for good still works: once she is gone and the window passes
    // with nobody back, the session is released.
    aliceAgain.disconnect();
    vi.advanceTimersByTime(IDLE_REAP_DELAY_MS);
    expect(
      world
        .harness()
        .received("session/close")
        .map((frame) => frame.params),
    ).toEqual([{ sessionId: SESSION }]);
  });

  /**
   * A connection dies mid-turn and the agent keeps talking to a room with
   * nobody in it. When the person comes back, everything said into that
   * silence must be waiting for them.
   *
   * The harness said each of those lines once, into a socket nobody held,
   * and was never told the reader dropped — nothing will make it repeat
   * itself. Only the runtime kept the conversation while nobody was
   * listening, and only it knows where the returning client's copy ends, so
   * handing back precisely the missed span — once — is its job.
   */
  it("should show a client that drops and comes back what was said while it was gone", () => {
    const world = createWorld();

    // Alice asks and sees the answer start.
    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(frames.prompt(2, SESSION, "run the whole test suite"));
    world.harness().emit(frames.agentMessage(SESSION, "starting the suite"));

    // Her connection dies mid-turn, and the agent keeps going with nobody
    // there to hear it.
    alice.disconnect();
    world.harness().emit(frames.agentMessage(SESSION, "unit tests passed"));
    world.harness().emit(frames.agentMessage(SESSION, "e2e passed"));

    // She comes back and opens the conversation again.
    const aliceAgain = world.connect();
    aliceAgain.send(frames.loadSession(1, SESSION));

    // She is not merely caught up but live again: the turn's last line
    // arrives as it is said, with no second ask needed.
    world.harness().emit(frames.agentMessage(SESSION, "all green"));
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    // Her load was answered, and the transcript is whole: what she saw
    // before the drop, what was said to nobody while she was gone, and what
    // came after her return — once each, in order.
    expect(aliceAgain.reply(1)).toBeDefined();
    expect(transcriptOf(aliceAgain)).toEqual([
      `${SESSION}: run the whole test suite`,
      `${SESSION}: starting the suite`,
      `${SESSION}: unit tests passed`,
      `${SESSION}: e2e passed`,
      `${SESSION}: all green`,
    ]);
  });
});
