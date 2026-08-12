import { describe, it, expect } from "vitest";
import { createWorld, frames, transcriptOf } from "./acp-world.js";

/**
 * Feature: joining a conversation already in progress.
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
   * Alice asks a question, and the agent is halfway through answering when
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

    // Alice asks, and the agent starts talking.
    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(frames.prompt(2, SESSION, "summarize this repo"));
    world.harness().emit(frames.agentMessage(SESSION, "it is a monorepo"));

    // Bob opens the conversation mid-answer.
    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));

    // The agent keeps going, then finishes the turn.
    world.harness().emit(frames.agentMessage(SESSION, "with three packages"));
    world.harness().emit(frames.agentMessage(SESSION, "and a Go module"));
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    // Bob's transcript reads as if he had been there from the start: the
    // question, what was said before he arrived, and — the point here —
    // every line the agent produced after he joined, live as it was said.
    expect(transcriptOf(bob)).toEqual([
      `${SESSION}: summarize this repo`,
      `${SESSION}: it is a monorepo`,
      `${SESSION}: with three packages`,
      `${SESSION}: and a Go module`,
    ]);

    // And his arrival changed nothing for Alice: her view of the turn is what
    // it would have been had he never joined. Her own question is absent
    // because she rendered it herself when she typed it.
    expect(transcriptOf(alice)).toEqual([
      `${SESSION}: it is a monorepo`,
      `${SESSION}: with three packages`,
      `${SESSION}: and a Go module`,
    ]);
  });
});
