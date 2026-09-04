import { describe, it, expect, afterEach, vi } from "vitest";
import {
  createWorld,
  frames,
  promptTextsOf,
  transcriptOf,
  IDLE_REAP_DELAY_MS,
  QUEUE_PARK_MS,
} from "./acp-world.js";

/**
 * TEST_OVERVIEW: leaving.
 *
 * Nobody says goodbye. A tab closes, a laptop lid drops, a connection just
 * dies — and the conversation, the other people in it, and the work in
 * flight must be exactly as they would have been with the socket still
 * there. Only what belonged to the leaver alone goes with them; queued work
 * belongs to the conversation, so it waits out a departure rather than
 * following it. Once nothing belongs to anyone, the sandbox lets the
 * conversation go.
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
   * TEST_SCENARIO: Two people are watching a turn and one of them leaves. The other must
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

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(frames.prompt(2, SESSION, "summarize this repo"));
    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));
    world.harness().emit(frames.agentMessage(SESSION, "it is a monorepo"));

    bob.disconnect();

    world.harness().emit(frames.agentMessage(SESSION, "with three packages"));
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    expect(alice.isOpen()).toBe(true);
    expect(alice.closes).toEqual([]);
    expect(alice.reply(2)?.result).toEqual({ stopReason: "end_turn" });
    expect(transcriptOf(alice)).toEqual([
      `${SESSION}: it is a monorepo`,
      `${SESSION}: with three packages`,
    ]);

    vi.advanceTimersByTime(IDLE_REAP_DELAY_MS);
    expect(world.harness().killed()).toBe(false);
    expect(world.harness().received("session/close")).toEqual([]);
  });

  /**
   * TEST_SCENARIO: The person whose turn is running disconnects while the agent is
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

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(frames.prompt(2, SESSION, "refactor the parser"));
    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));
    bob.send(frames.prompt(2, SESSION, "then run the tests"));

    alice.disconnect();

    world.harness().emit(frames.agentMessage(SESSION, "done, parser shrank"));
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    expect(world.harness().received("session/cancel")).toEqual([]);
    expect(promptTextsOf(world.harness())).toEqual([
      "refactor the parser",
      "then run the tests",
    ]);

    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });
    expect(bob.reply(2)?.result).toEqual({ stopReason: "end_turn" });
  });

  /**
   * TEST_SCENARIO: A queued message has not reached the harness yet; it exists only inside
   * the runtime. One of three people watching leaves before their message's
   * turn comes, and it still runs.
   *
   * The queue belongs to the conversation, not to the socket that filled it.
   * The runtime cannot tell a closed tab from a reloading one — a returning
   * client arrives as a brand-new channel with nothing tying it to the one
   * that left — so keying each queued message to its sender is what made a
   * page reload throw the user's own messages away. What the runtime can see
   * is whether anyone is engaged on the session at all, and while someone
   * is, every queued message still has a reader: its permission prompts fan
   * out to whoever is present, and its answer lands in the transcript they
   * all share.
   */
  it("should keep a leaver's queued messages while anyone is still watching", () => {
    const world = createWorld();

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

    bob.disconnect();

    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    expect(promptTextsOf(world.harness())).toEqual([
      "keep the build green",
      "also update the deps",
      "and tag a release",
    ]);
    expect(carol.reply(2)?.result).toEqual({ stopReason: "end_turn" });
  });

  /**
   * TEST_SCENARIO: A parked queue is dropped because nobody came back, and now the
   * session really is idle: no clients, no turn, no queue. It must be
   * released like any other abandoned conversation.
   *
   * The release check runs a few seconds after the last client leaves, which
   * is long before the park window closes — and it refuses to release a
   * session that still has queued work, correctly, because that work is
   * waiting for a return. Nothing else asks again afterwards, so dropping
   * the queue has to be its own cue to re-check, or a session nobody will
   * ever open again keeps its harness subprocess alive for the life of the
   * pod.
   */
  it("should release the session once its parked queue is dropped", () => {
    vi.useFakeTimers();
    const world = createWorld();

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(frames.prompt(2, SESSION, "run the migration"));
    alice.send(frames.prompt(3, SESSION, "then check the logs"));
    alice.disconnect();
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    vi.advanceTimersByTime(QUEUE_PARK_MS + IDLE_REAP_DELAY_MS);

    expect(
      world
        .harness()
        .received("session/close")
        .map((frame) => frame.params),
    ).toEqual([{ sessionId: SESSION }]);
  });

  /**
   * TEST_SCENARIO: The last person closes the tab on a finished conversation. Every open
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

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(frames.prompt(2, SESSION, "tidy the README"));
    world.harness().emit(frames.agentMessage(SESSION, "done"));
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    expect(world.harness().received("session/close")).toEqual([]);

    alice.disconnect();
    expect(world.harness().received("session/close")).toEqual([]);

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
   * TEST_SCENARIO: The other half of the quiescence window: someone closes the tab and
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

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(frames.prompt(2, SESSION, "tidy the README"));
    world.harness().emit(frames.agentMessage(SESSION, "done"));
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });
    alice.disconnect();

    const aliceAgain = world.connect();
    aliceAgain.send(frames.loadSession(1, SESSION));

    vi.advanceTimersByTime(IDLE_REAP_DELAY_MS * 3);
    expect(world.harness().received("session/close")).toEqual([]);
    expect(aliceAgain.reply(1)).toBeDefined();
    expect(transcriptOf(aliceAgain)).toEqual([
      `${SESSION}: tidy the README`,
      `${SESSION}: done`,
    ]);

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
   * TEST_SCENARIO: A connection dies mid-turn and the agent keeps talking to a room with
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

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(frames.prompt(2, SESSION, "run the whole test suite"));
    world.harness().emit(frames.agentMessage(SESSION, "starting the suite"));

    alice.disconnect();
    world.harness().emit(frames.agentMessage(SESSION, "unit tests passed"));
    world.harness().emit(frames.agentMessage(SESSION, "e2e passed"));

    const aliceAgain = world.connect();
    aliceAgain.send(frames.loadSession(1, SESSION));

    world.harness().emit(frames.agentMessage(SESSION, "all green"));
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

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
