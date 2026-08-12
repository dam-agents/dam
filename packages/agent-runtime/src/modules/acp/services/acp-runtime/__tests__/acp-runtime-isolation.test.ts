import { describe, it, expect } from "vitest";
import { createWorld, frames, transcriptOf } from "./acp-world.js";

/**
 * Feature: one client cannot see another's conversation.
 *
 * Every client in a sandbox shares one harness and one socket relay, so
 * keeping conversations apart is the runtime's job, not the harness's. These
 * scenarios are written as two people using the same sandbox at the same time,
 * and assert on what each of them saw.
 *
 * See `acp-runtime-connecting.test.ts` for the feature that gets them
 * connected in the first place.
 */

const ALICE_SESSION = "sess-alice";
const BOB_SESSION = "sess-bob";

describe("acp-runtime: session isolation", () => {
  /**
   * Two people in one sandbox, each in their own conversation. Neither should
   * ever see a line of the other's.
   *
   * The harness cannot do this for us. It writes every session's output to one
   * stdout and never learns that two people are attached, so as far as it is
   * concerned there is a single reader. Splitting that stream by who is
   * allowed to see what is the runtime's job.
   */
  it("should keep two clients in different sessions from seeing each other's messages", () => {
    const world = createWorld();

    // Two people open the same sandbox and each start their own conversation.
    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: ALICE_SESSION });

    const bob = world.connect();
    bob.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: BOB_SESSION });

    alice.send(frames.prompt(2, ALICE_SESSION, "did the tests pass?"));
    bob.send(frames.prompt(2, BOB_SESSION, "what is in this repo?"));

    world.harness().emit(frames.agentMessage(ALICE_SESSION, "all green"));
    world.harness().emit(frames.agentMessage(BOB_SESSION, "a k8s platform"));

    // Each transcript holds one conversation and nothing else. Both halves
    // matter: the answer reaches the person who asked, and the two people are
    // strangers to each other even though one harness served them both.
    expect(transcriptOf(alice)).toEqual([`${ALICE_SESSION}: all green`]);
    expect(transcriptOf(bob)).toEqual([`${BOB_SESSION}: a k8s platform`]);
  });

  /**
   * A client and a session are many-to-many. One socket serves a sandbox, not
   * a conversation, and it outlives whatever is on screen, so clicking through
   * the session list leaves a client watching everything it has visited.
   *
   * This is the scenario that pins that down. Every other one here still
   * passes if a connection could only ever watch a single session. This one
   * does not.
   */
  it("should give a client watching two sessions both conversations, without mixing them into the others'", () => {
    const world = createWorld();

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: ALICE_SESSION });

    const bob = world.connect();
    bob.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: BOB_SESSION });

    // A third person clicks through both conversations on one socket.
    const carol = world.connect();
    carol.send(frames.loadSession(1, ALICE_SESSION));
    carol.send(frames.loadSession(2, BOB_SESSION));

    alice.send(frames.prompt(2, ALICE_SESSION, "did the tests pass?"));
    bob.send(frames.prompt(2, BOB_SESSION, "what is in this repo?"));

    world.harness().emit(frames.agentMessage(ALICE_SESSION, "all green"));
    world.harness().emit(frames.agentMessage(BOB_SESSION, "a k8s platform"));

    // Carol's socket carries both conversations at once, each line saying
    // which one it belongs to. Watching a second conversation does not cost
    // her the first, and neither Alice nor Bob notices she is there.
    expect(transcriptOf(carol)).toEqual([
      `${ALICE_SESSION}: did the tests pass?`,
      `${BOB_SESSION}: what is in this repo?`,
      `${ALICE_SESSION}: all green`,
      `${BOB_SESSION}: a k8s platform`,
    ]);
    expect(transcriptOf(alice)).toEqual([`${ALICE_SESSION}: all green`]);
    expect(transcriptOf(bob)).toEqual([`${BOB_SESSION}: a k8s platform`]);
  });

  /**
   * The sidebar is a real client with no conversation open. It opens a
   * connection, asks what sessions exist, and closes it, on a poll, while
   * other people's turns are running. It never names a session.
   *
   * So being connected must not mean being subscribed. If it did, every poll
   * would pick up live traffic for conversations nobody has open: permission
   * dialogs would pop, sessions would be marked read behind the user's back,
   * and each one would be held off the reap.
   */
  it("should give a client that only lists sessions its answer and nothing else", () => {
    const world = createWorld();

    // Alice is mid-turn and the agent has stopped to ask her something.
    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: ALICE_SESSION });
    alice.send(frames.prompt(2, ALICE_SESSION, "delete the stale branches"));

    // The sidebar polls, on its own connection, naming no session.
    const sidebar = world.connect();
    sidebar.send(frames.listSessions(1));
    world.harness().replyTo("session/list", {
      sessions: [{ sessionId: ALICE_SESSION }, { sessionId: BOB_SESSION }],
    });

    world.harness().emit(frames.requestPermission(77, ALICE_SESSION));
    world.harness().emit(frames.agentMessage(ALICE_SESSION, "deleted 3"));

    // Knowing a conversation's name is not the same as being in it. The
    // sidebar gets the list it asked for and no session traffic at all, so a
    // background poll can never pop a dialog for a conversation nobody has
    // open, or mark one as read on the way past.
    expect(sidebar.reply(1)?.result).toEqual({
      sessions: [{ sessionId: ALICE_SESSION }, { sessionId: BOB_SESSION }],
    });
    expect(sidebar.saw("session/request_permission")).toEqual([]);
    expect(transcriptOf(sidebar)).toEqual([]);

    // And the prompt did reach the person whose turn it interrupted, so the
    // assertions above are not green just because it went nowhere.
    expect(alice.saw("session/request_permission")).toHaveLength(1);
    expect(transcriptOf(alice)).toEqual([`${ALICE_SESSION}: deleted 3`]);
  });

  /**
   * A request id is only unique within one connection. Every client numbers
   * its own requests from 1 and cannot see anyone else's, so two clients using
   * the same number is normal, not a mistake.
   *
   * Only the runtime can sort that out. The clients do not know each other
   * exists, and the harness reads one stdin, so two requests numbered 7 look
   * to it like one request asked twice. So the runtime gives each forwarded
   * request an id of its own and puts the sender's number back on the answer.
   */
  it("should keep two clients' identically-numbered requests apart, and answer each under its own number", () => {
    const world = createWorld();

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: ALICE_SESSION });

    const bob = world.connect();
    bob.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: BOB_SESSION });

    // Both ask under id 7, and both questions are in flight at once.
    alice.send(frames.prompt(7, ALICE_SESSION, "did the tests passi rea?"));
    bob.send(frames.prompt(7, BOB_SESSION, "what is in this repo?"));

    // Both arrived at the harness carrying different numbers. Had they both
    // said 7, the harness would have no way to say which answer belonged to
    // which.
    const forwardedIds = world
      .harness()
      .received("session/prompt")
      .map((frame) => frame.id);
    expect(new Set(forwardedIds).size).toBe(2);

    // Answering Bob answers Bob, and leaves Alice still waiting.
    world.harness().replyToSession("session/prompt", BOB_SESSION, {
      stopReason: "end_turn",
    });
    expect(bob.reply(7)?.result).toEqual({ stopReason: "end_turn" });
    expect(alice.reply(7)).toBeUndefined();

    // Alice's own answer reaches her afterwards, and it is hers rather than a
    // copy of Bob's. It comes back under the number she chose, which is the
    // only one she can match it against.
    world.harness().replyToSession("session/prompt", ALICE_SESSION, {
      stopReason: "refusal",
    });
    expect(alice.reply(7)?.result).toEqual({ stopReason: "refusal" });
  });

  /**
   * A connection opens before the user picks a conversation. The tab connects
   * to the sandbox on arrival, then the user reads the list, thinks, and
   * clicks — so every client spends time connected and entitled to nothing.
   *
   * The runtime must not read the socket's existence as interest. The harness
   * offers no help here either way: it streams to one stdout whether one
   * client is watching or none. So the moment a conversation's traffic starts
   * flowing to a client has to be the client's own touch of that session,
   * and the runtime is the only thing positioned to hold that line.
   */
  it("should hold a session's traffic back from a connected client until it touches the session", () => {
    const world = createWorld();

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: ALICE_SESSION });

    // Carol opens the sandbox and stops there. No conversation picked yet,
    // but her socket is open for everything that follows.
    const carol = world.connect();

    alice.send(frames.prompt(2, ALICE_SESSION, "did the tests pass?"));
    world.harness().emit(frames.agentMessage(ALICE_SESSION, "running them"));

    // Connected is not subscribed. The whole exchange happened while Carol
    // was attached, and none of it touched her socket.
    expect(transcriptOf(carol)).toEqual([]);
    expect(transcriptOf(alice)).toEqual([`${ALICE_SESSION}: running them`]);

    // Now she opens the conversation.
    carol.send(frames.loadSession(1, ALICE_SESSION));
    world.harness().emit(frames.agentMessage(ALICE_SESSION, "all green"));

    // The touch is what turned the tap on. What she missed arrives at the
    // touch as a catch-up, and from then on she is live — nothing reached
    // her a moment earlier than she asked for it.
    expect(transcriptOf(carol)).toEqual([
      `${ALICE_SESSION}: did the tests pass?`,
      `${ALICE_SESSION}: running them`,
      `${ALICE_SESSION}: all green`,
    ]);
    // And Carol's catch-up was hers alone: Alice got no second copy.
    expect(transcriptOf(alice)).toEqual([
      `${ALICE_SESSION}: running them`,
      `${ALICE_SESSION}: all green`,
    ]);
  });
});
