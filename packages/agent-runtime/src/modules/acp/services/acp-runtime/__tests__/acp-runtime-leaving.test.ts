import { describe, it, expect, afterEach, vi } from "vitest";
import {
  createWorld,
  frames,
  promptTextsOf,
  transcriptOf,
  IDLE_REAP_DELAY_MS,
} from "./acp-world.js";

const SESSION = "sess-shared";

describe("acp-runtime: leaving", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it("should drop a leaver's queued messages but nobody else's", () => {
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

    expect(promptTextsOf(world.harness())).toEqual([
      "keep the build green",
      "and tag a release",
    ]);
    expect(carol.reply(2)?.result).toEqual({ stopReason: "end_turn" });
  });

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
