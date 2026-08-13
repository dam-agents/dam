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
