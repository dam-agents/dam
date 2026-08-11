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

  it("should give a client watching two sessions both conversations, without mixing them into the others'", () => {
    const world = createWorld();

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: ALICE_SESSION });

    const bob = world.connect();
    bob.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: BOB_SESSION });

    // A third person opens both conversations. One sandbox is one socket, and
    // it outlives the conversation on screen: clicking through the session
    // list leaves a client watching everything it has visited.
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
});
