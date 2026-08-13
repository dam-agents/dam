import { describe, it, expect } from "vitest";
import { createWorld, frames, transcriptOf } from "./acp-world.js";

const ALICE_SESSION = "sess-alice";
const BOB_SESSION = "sess-bob";

describe("acp-runtime: session isolation", () => {
  it("should keep two clients in different sessions from seeing each other's messages", () => {
    const world = createWorld();

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

    const carol = world.connect();
    carol.send(frames.loadSession(1, ALICE_SESSION));
    carol.send(frames.loadSession(2, BOB_SESSION));

    alice.send(frames.prompt(2, ALICE_SESSION, "did the tests pass?"));
    bob.send(frames.prompt(2, BOB_SESSION, "what is in this repo?"));

    world.harness().emit(frames.agentMessage(ALICE_SESSION, "all green"));
    world.harness().emit(frames.agentMessage(BOB_SESSION, "a k8s platform"));

    expect(transcriptOf(carol)).toEqual([
      `${ALICE_SESSION}: did the tests pass?`,
      `${BOB_SESSION}: what is in this repo?`,
      `${ALICE_SESSION}: all green`,
      `${BOB_SESSION}: a k8s platform`,
    ]);
    expect(transcriptOf(alice)).toEqual([`${ALICE_SESSION}: all green`]);
    expect(transcriptOf(bob)).toEqual([`${BOB_SESSION}: a k8s platform`]);
  });

  it("should give a client that only lists sessions its answer and nothing else", () => {
    const world = createWorld();

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: ALICE_SESSION });
    alice.send(frames.prompt(2, ALICE_SESSION, "delete the stale branches"));

    const sidebar = world.connect();
    sidebar.send(frames.listSessions(1));
    world.harness().replyTo("session/list", {
      sessions: [{ sessionId: ALICE_SESSION }, { sessionId: BOB_SESSION }],
    });

    world.harness().emit(frames.requestPermission(77, ALICE_SESSION));
    world.harness().emit(frames.agentMessage(ALICE_SESSION, "deleted 3"));

    expect(sidebar.reply(1)?.result).toEqual({
      sessions: [{ sessionId: ALICE_SESSION }, { sessionId: BOB_SESSION }],
    });
    expect(sidebar.saw("session/request_permission")).toEqual([]);
    expect(transcriptOf(sidebar)).toEqual([]);

    expect(alice.saw("session/request_permission")).toHaveLength(1);
    expect(transcriptOf(alice)).toEqual([`${ALICE_SESSION}: deleted 3`]);
  });

  it("should keep two clients' identically-numbered requests apart, and answer each under its own number", () => {
    const world = createWorld();

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: ALICE_SESSION });

    const bob = world.connect();
    bob.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: BOB_SESSION });

    alice.send(frames.prompt(7, ALICE_SESSION, "did the tests passi rea?"));
    bob.send(frames.prompt(7, BOB_SESSION, "what is in this repo?"));

    const forwardedIds = world
      .harness()
      .received("session/prompt")
      .map((frame) => frame.id);
    expect(new Set(forwardedIds).size).toBe(2);

    world.harness().replyToSession("session/prompt", BOB_SESSION, {
      stopReason: "end_turn",
    });
    expect(bob.reply(7)?.result).toEqual({ stopReason: "end_turn" });
    expect(alice.reply(7)).toBeUndefined();

    world.harness().replyToSession("session/prompt", ALICE_SESSION, {
      stopReason: "refusal",
    });
    expect(alice.reply(7)?.result).toEqual({ stopReason: "refusal" });
  });

  it("should hold a session's traffic back from a connected client until it touches the session", () => {
    const world = createWorld();

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: ALICE_SESSION });

    const carol = world.connect();

    alice.send(frames.prompt(2, ALICE_SESSION, "did the tests pass?"));
    world.harness().emit(frames.agentMessage(ALICE_SESSION, "running them"));

    expect(transcriptOf(carol)).toEqual([]);
    expect(transcriptOf(alice)).toEqual([`${ALICE_SESSION}: running them`]);

    carol.send(frames.loadSession(1, ALICE_SESSION));
    world.harness().emit(frames.agentMessage(ALICE_SESSION, "all green"));

    expect(transcriptOf(carol)).toEqual([
      `${ALICE_SESSION}: did the tests pass?`,
      `${ALICE_SESSION}: running them`,
      `${ALICE_SESSION}: all green`,
    ]);
    expect(transcriptOf(alice)).toEqual([
      `${ALICE_SESSION}: running them`,
      `${ALICE_SESSION}: all green`,
    ]);
  });
});
