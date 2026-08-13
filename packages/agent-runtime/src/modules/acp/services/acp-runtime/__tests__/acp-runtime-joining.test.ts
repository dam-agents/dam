import { describe, it, expect } from "vitest";
import { createWorld, frames, transcriptOf } from "./acp-world.js";

/**
 * TEST_OVERVIEW: joining a conversation already in progress.
 *
 * A conversation does not pause for latecomers. Someone opens a session while
 * the agent is mid-answer, and what they should end up with is the
 * conversation as it stands plus everything still to come — as if they had
 * been there all along.
 *
 * See `acp-runtime-isolation.test.ts` for who may see a session at all; this
 * feature is about what a permitted joiner sees once they open it.
 */

const SESSION = "sess-shared";

describe("acp-runtime: joining mid-conversation", () => {
  /**
   * TEST_SCENARIO: Alice asks a question, and the agent is halfway through answering when
   * Bob opens the same conversation. Everything the agent says from that
   * moment on must reach Bob as it happens.
   *
   * The harness cannot arrange this. It streams the turn to one stdout and
   * never learns that a second reader arrived partway through, so splicing a
   * latecomer into an in-flight stream — without stalling the turn or
   * disturbing the people already watching — is the runtime's job.
   */
  it("should stream the rest of an in-flight turn to a client that joins mid-turn", () => {
    const world = createWorld();

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(frames.prompt(2, SESSION, "summarize this repo"));
    world.harness().emit(frames.agentMessage(SESSION, "it is a monorepo"));

    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));

    world.harness().emit(frames.agentMessage(SESSION, "with three packages"));
    world.harness().emit(frames.agentMessage(SESSION, "and a Go module"));
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    expect(transcriptOf(bob)).toEqual([
      `${SESSION}: summarize this repo`,
      `${SESSION}: it is a monorepo`,
      `${SESSION}: with three packages`,
      `${SESSION}: and a Go module`,
    ]);

    expect(transcriptOf(alice)).toEqual([
      `${SESSION}: it is a monorepo`,
      `${SESSION}: with three packages`,
      `${SESSION}: and a Go module`,
    ]);
  });

  /**
   * TEST_SCENARIO: A whole turn has come and gone before Bob opens the conversation. He must
   * be given everything he missed, and given it once — including when he asks
   * again, which real clients do every time the user clicks away to the
   * session list and back.
   *
   * The harness said each of these lines exactly once, to whoever was
   * listening at the time, and it is never told who heard what. Only the
   * runtime knows where each client's copy of the conversation ends, so
   * handing a joiner precisely the gap — and handing a repeat request
   * nothing at all while still answering it — is bookkeeping only the
   * runtime can do.
   */
  it("should deliver the history a joiner missed exactly once, even when it asks again", () => {
    const world = createWorld();

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(frames.prompt(2, SESSION, "what is this repo"));
    world.harness().emit(frames.agentMessage(SESSION, "an agent platform"));
    world.harness().emit(frames.agentMessage(SESSION, "running on k8s"));
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));
    expect(transcriptOf(bob)).toEqual([
      `${SESSION}: what is this repo`,
      `${SESSION}: an agent platform`,
      `${SESSION}: running on k8s`,
    ]);

    alice.send(frames.prompt(3, SESSION, "how do I run it"));
    world.harness().emit(frames.agentMessage(SESSION, "use mise"));
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    bob.send(frames.loadSession(2, SESSION));

    expect(bob.reply(1)).toBeDefined();
    expect(bob.reply(2)).toBeDefined();

    expect(transcriptOf(bob)).toEqual([
      `${SESSION}: what is this repo`,
      `${SESSION}: an agent platform`,
      `${SESSION}: running on k8s`,
      `${SESSION}: how do I run it`,
      `${SESSION}: use mise`,
    ]);

    expect(transcriptOf(alice)).toEqual([
      `${SESSION}: an agent platform`,
      `${SESSION}: running on k8s`,
      `${SESSION}: use mise`,
    ]);
  });

  /**
   * TEST_SCENARIO: The agent has stopped mid-turn to ask before doing something, and the
   * question is still unanswered when Bob opens the conversation. The whole
   * turn is blocked on it, so of everything Bob could be shown, the open
   * prompt matters most — and he may well be the one who came to answer it.
   *
   * The harness asked exactly once, on its one stdout, and is now blocked
   * waiting for the reply. It will not repeat the question for a reader it
   * never knew arrived. Nor can the question ride in with the history: a
   * prompt is not transcript, it is a request that is later answered and
   * withdrawn, and replaying it from history would re-open dialogs long
   * settled. Only the runtime still holds the open question, so putting it
   * in front of a latecomer is the runtime's job.
   */
  it("should show a joiner the permission prompt that is open when it arrives", () => {
    const world = createWorld();

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(frames.prompt(2, SESSION, "delete the stale branches"));

    world.harness().emit(frames.requestPermission(77, SESSION));

    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));

    expect(bob.saw("session/request_permission")).toEqual([
      frames.requestPermission(77, SESSION),
    ]);

    expect(bob.reply(1)).toBeDefined();

    expect(alice.saw("session/request_permission")).toEqual([
      frames.requestPermission(77, SESSION),
    ]);
  });

  /**
   * TEST_SCENARIO: The flip side of the scenario above: the question was answered before Bob
   * arrived. Showing it to him would ask him to decide something already
   * decided — at best a dead dialog to dismiss, at worst a second "allow" for
   * an action that already ran.
   *
   * The tempting way to satisfy the scenario above is to treat prompts as
   * history and replay them to joiners. This scenario is what rules that out:
   * history never forgets, so every future joiner would be re-asked forever.
   * A prompt has a lifetime — opened by the harness, closed by whichever
   * client answers — and the runtime is the only party that sees both ends,
   * so it alone can tell an open question from a settled one.
   */
  it("should not show a joiner a prompt that was answered before it arrived", () => {
    const world = createWorld();

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(frames.prompt(2, SESSION, "delete the stale branches"));
    world.harness().emit(frames.requestPermission(77, SESSION));
    alice.send(frames.permissionAnswer(77));

    world.harness().emit(frames.agentMessage(SESSION, "deleting them now"));

    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));

    expect(bob.saw("session/request_permission")).toEqual([]);

    expect(bob.reply(1)).toBeDefined();
    world.harness().emit(frames.agentMessage(SESSION, "done, three removed"));
    expect(transcriptOf(bob)).toEqual([
      `${SESSION}: delete the stale branches`,
      `${SESSION}: deleting them now`,
      `${SESSION}: done, three removed`,
    ]);
  });

  /**
   * TEST_SCENARIO: An open question has more than one possible answerer: everyone looking at
   * the conversation sees the same dialog, and the inbox can answer it too —
   * an egress approval comes home on a one-shot connection that never opens
   * any session. Sooner or later, two of them answer.
   *
   * The harness asked once and expects one reply. It reads one stdin, so a
   * second response to the same id is a conversation it never started —
   * at best noise, at worst an SDK error. Only the runtime sees every
   * answerer, so electing the first answer and swallowing the rest is its
   * job. And "whoever sent it" is load-bearing: requiring the answerer to
   * have opened the session would silence the inbox, which by construction
   * never has.
   */
  it("should honor only the first answer to a permission prompt, whoever sends it", () => {
    const world = createWorld();

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(frames.prompt(2, SESSION, "delete the stale branches"));
    world.harness().emit(frames.requestPermission(77, SESSION));
    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));

    const inbox = world.connect();
    inbox.send(frames.permissionAnswer(77, "allow"));

    bob.send(frames.permissionAnswer(77, "reject"));

    expect(world.harness().answersTo(77)).toEqual([
      frames.permissionAnswer(77, "allow"),
    ]);

    world.harness().emit(frames.agentMessage(SESSION, "deleting them now"));
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });
    expect(transcriptOf(alice)).toEqual([`${SESSION}: deleting them now`]);
    expect(transcriptOf(bob)).toEqual([
      `${SESSION}: delete the stale branches`,
      `${SESSION}: deleting them now`,
    ]);
  });

  /**
   * TEST_SCENARIO: A turn ends. Alice, who asked, learns this the natural JSON-RPC way: her
   * request completes. Bob is watching the same conversation with nothing in
   * flight, and ACP has no "turn ended" on the wire — left to the protocol
   * alone, he would watch the reply trail off with nothing to say it is done,
   * and his composer would stay locked on a turn that ended.
   *
   * The harness cannot tell him: completing Alice's request is the only end-
   * of-turn signal it emits, and only she holds that request. Turning one
   * party's response into everyone's boundary takes knowing who else is
   * watching, and only the runtime knows that.
   */
  it("should tell both clients the turn ended, not just the one who asked", () => {
    const world = createWorld();

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(frames.prompt(2, SESSION, "summarize this repo"));
    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));
    world.harness().emit(frames.agentMessage(SESSION, "it is a monorepo"));
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    expect(alice.reply(2)?.result).toEqual({ stopReason: "end_turn" });

    const ended = {
      jsonrpc: "2.0",
      method: "platform/turnEnded",
      params: { sessionId: SESSION },
    };
    expect(alice.saw("platform/turnEnded")).toEqual([ended]);
    expect(bob.saw("platform/turnEnded")).toEqual([ended]);
  });

  /**
   * TEST_SCENARIO: Alice's own message must not come back at her: her UI rendered it the
   * moment she hit send, and an echo would double it on screen. But the
   * suppression has to be per-connection, not per-person — when her tab
   * reloads, the optimistic copy died with the old page, and the reconnect
   * is the one place her own words must come back.
   *
   * The runtime is what makes both true at once. It keeps her message in the
   * conversation's history for everyone — that is how Bob sees it at all —
   * while remembering, per connection, that hers already has it. Forget the
   * first half and every send echoes; forget the second and every reload
   * loses what she said.
   */
  it("should not echo a message back to its sender, who still sees it after a reconnect", () => {
    const world = createWorld();

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(frames.prompt(2, SESSION, "did the tests pass?"));
    world.harness().emit(frames.agentMessage(SESSION, "running them"));

    expect(transcriptOf(alice)).toEqual([`${SESSION}: running them`]);

    alice.disconnect();
    const aliceAgain = world.connect();
    aliceAgain.send(frames.loadSession(1, SESSION));

    expect(aliceAgain.reply(1)).toBeDefined();
    world.harness().emit(frames.agentMessage(SESSION, "all green"));
    expect(transcriptOf(aliceAgain)).toEqual([
      `${SESSION}: did the tests pass?`,
      `${SESSION}: running them`,
      `${SESSION}: all green`,
    ]);
  });
});
