import { describe, it, expect, afterEach, vi } from "vitest";
import {
  createSessionMetadata,
  createWorld,
  frames,
  promptTextsOf,
  IDLE_REAP_DELAY_MS,
} from "./acp-world.js";

const SESSION = "sess-scheduled";

describe("acp-runtime: the machine client", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("should run a scheduled turn to completion with no human connected", () => {
    const world = createWorld();

    const machine = world.connect({ viewer: false });
    machine.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    machine.send(frames.prompt(2, SESSION, "run the nightly dependency audit"));
    machine.disconnect();

    expect(world.runtime.status().idle).toBe(false);

    world.harness().emit(frames.agentMessage(SESSION, "two majors, one CVE"));
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    expect(promptTextsOf(world.harness())).toEqual([
      "run the nightly dependency audit",
    ]);
    expect(world.harness().received("session/cancel")).toEqual([]);
    expect(world.harness().killed()).toBe(false);
    expect(world.runtime.status().idle).toBe(true);
  });

  it("should not mark a scheduled turn's conversation as read", () => {
    const meta = createSessionMetadata();
    const world = createWorld({ sessionMetadata: meta.store });

    const machine = world.connect({ viewer: false });
    machine.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    machine.send(frames.prompt(2, SESSION, "triage the new issues"));
    machine.disconnect();
    world.harness().emit(frames.agentMessage(SESSION, "labelled three"));
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    expect(meta.unread(SESSION)).toBe(true);

    const human = world.connect();
    human.send(frames.loadSession(1, SESSION));
    expect(meta.unread(SESSION)).toBe(false);
  });

  it("should release a scheduled turn's session when it finishes", () => {
    vi.useFakeTimers();
    const world = createWorld();

    const machine = world.connect({ viewer: false });
    machine.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    machine.send(frames.prompt(2, SESSION, "rotate the credentials"));
    machine.disconnect();

    vi.advanceTimersByTime(IDLE_REAP_DELAY_MS);
    expect(world.harness().received("session/close")).toEqual([]);

    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    vi.advanceTimersByTime(IDLE_REAP_DELAY_MS);
    expect(
      world
        .harness()
        .received("session/close")
        .map((frame) => frame.params),
    ).toEqual([{ sessionId: SESSION }]);
    expect(world.harness().killed()).toBe(false);
  });
});
