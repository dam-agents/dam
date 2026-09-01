import { describe, it, expect, afterEach, vi } from "vitest";
import { createWorld, frames } from "./acp-world.js";

/**
 * TEST_OVERVIEW: unanswered requests.
 *
 * The agent asks a question — usually "may I run this tool?" — and nobody
 * is there to answer. The question must wait, follow the user back in if
 * they return, and die cleanly if they don't: the agent gets an error so
 * the tool call aborts instead of hanging forever. Resetting the session
 * ends the question the same way, since the session id lives on.
 */

const ORPHAN_TTL_MS = 60_000;
const SESSION = "sess-unanswered";

describe("acp-runtime: unanswered requests", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * TEST_SCENARIO: The user's tab is gone when the agent asks for permission,
   * and nobody comes back. After the TTL the agent must get a clear error,
   * so the tool call aborts instead of hanging. Once the turn ends, the
   * runtime must report itself idle again, so the sandbox can hibernate.
   */
  it("should abort the tool call when nobody answers in time", () => {
    vi.useFakeTimers();
    const world = createWorld({ orphanTtlMs: ORPHAN_TTL_MS });

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(frames.prompt(2, SESSION, "delete the build folder"));
    alice.disconnect();

    world.harness().emit(frames.requestPermission(50, SESSION));
    vi.advanceTimersByTime(ORPHAN_TTL_MS);

    expect(world.harness().answersTo(50)[0]).toMatchObject({
      error: {
        code: -32000,
        message: "Permission request expired: no client connected",
      },
    });

    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });
    expect(world.runtime.status().idle).toBe(true);
  });

  /**
   * TEST_SCENARIO: The agent asked while nobody was connected. A user comes
   * back before the deadline and opens the session. They must see the
   * permission prompt right away, without asking for it — the question
   * followed them back in.
   */
  it("should ask the question again when the user comes back", () => {
    vi.useFakeTimers();
    const world = createWorld({ orphanTtlMs: ORPHAN_TTL_MS });

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(frames.prompt(2, SESSION, "install the linter"));
    alice.disconnect();
    world.harness().emit(frames.requestPermission(51, SESSION));

    vi.advanceTimersByTime(ORPHAN_TTL_MS / 2);
    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));

    expect(bob.saw("session/request_permission")).toHaveLength(1);
  });

  /**
   * TEST_SCENARIO: A user came back in time. From then on the question must
   * not expire, however long they think — someone is there now, and people
   * are allowed to take their time. A late answer must still reach the
   * agent.
   */
  it("should stop the clock once someone is back", () => {
    vi.useFakeTimers();
    const world = createWorld({ orphanTtlMs: ORPHAN_TTL_MS });

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(frames.prompt(2, SESSION, "install the linter"));
    alice.disconnect();
    world.harness().emit(frames.requestPermission(51, SESSION));

    vi.advanceTimersByTime(ORPHAN_TTL_MS / 2);
    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));

    vi.advanceTimersByTime(ORPHAN_TTL_MS * 10);
    expect(world.harness().answersTo(51)).toEqual([]);

    bob.send(frames.permissionAnswer(51));
    expect(world.harness().answersTo(51)[0]).toMatchObject({
      result: { outcome: { outcome: "selected", optionId: "allow" } },
    });
  });

  /**
   * TEST_SCENARIO: A config change arrives while a permission prompt is
   * still open, so the harness recycle waits — the runtime counts the open
   * question as work. When the question expires, nothing is running
   * anymore, and the deferred recycle must go through on its own. An
   * abandoned question must not block a config change forever.
   */
  it("should let a waiting config change go through once the question expires", () => {
    vi.useFakeTimers();
    const world = createWorld({ orphanTtlMs: ORPHAN_TTL_MS });

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    world.harness().emit(frames.requestPermission(52, SESSION));
    alice.disconnect();

    world.runtime.refreshEnv({ force: false });
    expect(world.harness().killed()).toBe(false);

    vi.advanceTimersByTime(ORPHAN_TTL_MS);
    expect(world.harness().answersTo(52)[0]).toMatchObject({
      error: { code: -32000 },
    });
    expect(world.harness().killed()).toBe(true);
  });

  /**
   * TEST_SCENARIO: A permission prompt is still open when the user resets the
   * session. The reset must end it: the agent gets the abort error, and the
   * runtime reports itself idle again so the idle checker can hibernate the
   * Agent. One abandoned prompt must not keep a pod running for good.
   */
  it("should end an open question when the session is reset", () => {
    vi.useFakeTimers();
    const world = createWorld({ orphanTtlMs: ORPHAN_TTL_MS });

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(frames.prompt(2, SESSION, "delete the build folder"));
    world.harness().emit(frames.requestPermission(60, SESSION));
    alice.disconnect();

    world.runtime.resetSession(SESSION);

    expect(world.harness().answersTo(60)[0]).toMatchObject({
      error: {
        code: -32000,
        message: "Permission request cancelled: session reset",
      },
    });
    expect(world.runtime.status().idle).toBe(true);
  });

  /**
   * TEST_SCENARIO: A question was open when the session was reset. The session
   * id survives a reset and gets used again, so whoever opens it next must
   * find it clean. A prompt about a tool call from before the reset must not
   * pop up in the new conversation.
   */
  it("should not ask an old question again after a reset", () => {
    vi.useFakeTimers();
    const world = createWorld({ orphanTtlMs: ORPHAN_TTL_MS });

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    world.harness().emit(frames.requestPermission(61, SESSION));
    alice.disconnect();

    world.runtime.resetSession(SESSION);

    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));

    expect(bob.saw("session/request_permission")).toEqual([]);
  });

  /**
   * TEST_SCENARIO: The TTL clock was already ticking when the session was
   * reset. It must go with the session. If it still fired, the agent would
   * get a second, late answer for a question that was already cancelled —
   * and by then that request id may belong to a different tool call.
   */
  it("should stop the clock when the session is reset", () => {
    vi.useFakeTimers();
    const world = createWorld({ orphanTtlMs: ORPHAN_TTL_MS });

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    world.harness().emit(frames.requestPermission(62, SESSION));
    alice.disconnect();

    world.runtime.resetSession(SESSION);
    vi.advanceTimersByTime(ORPHAN_TTL_MS * 10);

    expect(world.harness().answersTo(62)).toHaveLength(1);
    expect(world.harness().answersTo(62)[0]).toMatchObject({
      error: { message: "Permission request cancelled: session reset" },
    });
  });

  /**
   * TEST_SCENARIO: The agent asks something tied to no session. Nobody is
   * connected and far more than the TTL passes. The question must not
   * expire and the runtime must stay busy. This pins today's behaviour on
   * purpose: if we ever change it, this test should say so out loud.
   */
  it("should keep a question with no session waiting forever", () => {
    vi.useFakeTimers();
    const world = createWorld({ orphanTtlMs: ORPHAN_TTL_MS });

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.disconnect();

    world.harness().emit({
      jsonrpc: "2.0",
      id: 77,
      method: "fs/read_text_file",
      params: { path: "/workspace/README.md" },
    });

    vi.advanceTimersByTime(ORPHAN_TTL_MS * 10);
    expect(world.harness().answersTo(77)).toEqual([]);
    expect(world.runtime.status().idle).toBe(false);
  });

  /**
   * TEST_SCENARIO: The agent asks with an empty-string session id. That is
   * not a real session, so it must behave exactly like a question with no
   * session at all: broadcast, wait forever, never expire. Pins the rule
   * that "" is session-less for Pending Agent Requests.
   */
  it("should treat an empty-string session id as no session", () => {
    vi.useFakeTimers();
    const world = createWorld({ orphanTtlMs: ORPHAN_TTL_MS });

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.disconnect();

    world.harness().emit(frames.requestPermission(53, ""));

    vi.advanceTimersByTime(ORPHAN_TTL_MS * 10);
    expect(world.harness().answersTo(53)).toEqual([]);
    expect(world.runtime.status().idle).toBe(false);
  });
});
