import { describe, it, expect, afterEach, vi } from "vitest";
import { createWorld, frames } from "./acp-world.js";
import type { AgentRequestObserver } from "../pending-agent-requests.js";

function recordingObserver() {
  const heard: unknown[][] = [];
  const observer: AgentRequestObserver = {
    waiting: (id, sessionId) => heard.push(["waiting", id, sessionId]),
    answered: (id, sessionId, result) =>
      heard.push(["answered", id, sessionId, result]),
    abandoned: (id, sessionId) => heard.push(["abandoned", id, sessionId]),
  };
  return { heard, observer };
}

/**
 * TEST_OVERVIEW: unanswered requests.
 *
 * The agent asks a question — usually "may I run this tool?" — and nobody
 * is there to answer. The question must wait, follow the user back in if
 * they return, and die cleanly if they don't: the agent gets an error so
 * the tool call aborts instead of hanging forever. Resetting the session
 * ends the question the same way, since the session id lives on. A question
 * nobody can see is reported to the platform the moment that is so, and its
 * end is reported too, so the platform can show it without a viewer.
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
   * permission prompt right away, without asking for it, and from then on the
   * question must not expire however long they think: a late answer must
   * still reach the agent.
   */
  it("should ask the question again when the user comes back, and stop the clock", () => {
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
   * TEST_SCENARIO: A permission prompt is still open, its TTL clock ticking,
   * when the user resets the session. The reset must end it: the agent gets
   * the abort error once, and the runtime reports itself idle so the pod can
   * hibernate. The clock must go with it, or a late second answer could reach
   * a request id that by then belongs to another tool call. The session id
   * survives a reset, so whoever opens it next must not see the old question.
   */
  it("should end an open question and its clock when the session is reset", () => {
    vi.useFakeTimers();
    const world = createWorld({ orphanTtlMs: ORPHAN_TTL_MS });

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(frames.prompt(2, SESSION, "delete the build folder"));
    world.harness().emit(frames.requestPermission(60, SESSION));
    alice.disconnect();

    world.runtime.resetSession(SESSION);
    expect(world.runtime.status().idle).toBe(true);

    vi.advanceTimersByTime(ORPHAN_TTL_MS * 10);
    expect(world.harness().answersTo(60)).toEqual([
      expect.objectContaining({
        error: {
          code: -32000,
          message: "Permission request cancelled: session reset",
        },
      }),
    ]);

    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));
    expect(bob.saw("session/request_permission")).toEqual([]);
  });

  /**
   * TEST_SCENARIO: The agent asks something tied to no session, or with an
   * empty-string session id, which is not a real session either. Nobody is
   * connected and far more than the TTL passes. Neither question may expire
   * and the runtime must stay busy. This pins today's behaviour on purpose:
   * if we ever change it, this test should say so out loud.
   */
  it("should keep a question with no or an empty session waiting forever", () => {
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
    world.harness().emit(frames.requestPermission(53, ""));

    vi.advanceTimersByTime(ORPHAN_TTL_MS * 10);
    expect(world.harness().answersTo(77)).toEqual([]);
    expect(world.harness().answersTo(53)).toEqual([]);
    expect(world.runtime.status().idle).toBe(false);
  });

  /**
   * TEST_SCENARIO: The agent asks while nobody watches the session. The
   * platform must hear of the question at once, not when someone opens the
   * session, so Home can show it with the time the agent asked. An answer
   * that comes later must be reported too, with what was chosen, so the
   * platform's record of the question ends with it.
   */
  it("should report a question nobody can see when it is asked, and its answer", () => {
    const { heard, observer } = recordingObserver();
    const world = createWorld({ agentRequests: observer });

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(frames.prompt(2, SESSION, "delete the build folder"));
    alice.disconnect();

    world.harness().emit(frames.requestPermission(54, SESSION));
    expect(heard).toEqual([["waiting", 54, SESSION]]);

    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));
    bob.send(frames.permissionAnswer(54));
    expect(heard).toEqual([
      ["waiting", 54, SESSION],
      [
        "answered",
        54,
        SESSION,
        { outcome: { outcome: "selected", optionId: "allow" } },
      ],
    ]);
  });

  /**
   * TEST_SCENARIO: The user watches the session when the agent asks, then
   * closes the tab before answering. The platform needs no report while the
   * prompt is on screen, since the client relay records it, but must hear of
   * it once nobody can see it, and exactly once however often viewers come
   * and go.
   */
  it("should report a question once, when its last viewer leaves", () => {
    const { heard, observer } = recordingObserver();
    const world = createWorld({ agentRequests: observer });

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    world.harness().emit(frames.requestPermission(55, SESSION));
    expect(heard).toEqual([]);

    alice.disconnect();
    expect(heard).toEqual([["waiting", 55, SESSION]]);

    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));
    bob.disconnect();
    expect(heard).toEqual([["waiting", 55, SESSION]]);
  });

  /**
   * TEST_SCENARIO: A question nobody saw expires, or the session is reset
   * under it. Either way the agent no longer waits for an answer, so the
   * platform must hear that the question is gone and stop offering it.
   */
  it("should report a question nobody answered when it expires or is reset", () => {
    vi.useFakeTimers();
    const { heard, observer } = recordingObserver();
    const world = createWorld({
      orphanTtlMs: ORPHAN_TTL_MS,
      agentRequests: observer,
    });

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.disconnect();
    world.harness().emit(frames.requestPermission(56, SESSION));
    vi.advanceTimersByTime(ORPHAN_TTL_MS);
    world.harness().emit(frames.requestPermission(57, SESSION));
    world.runtime.resetSession(SESSION);

    expect(heard).toEqual([
      ["waiting", 56, SESSION],
      ["abandoned", 56, SESSION],
      ["waiting", 57, SESSION],
      ["abandoned", 57, SESSION],
    ]);
  });

  /**
   * TEST_SCENARIO: The user answers a question while watching it. The client
   * relay records that answer, so the platform must not hear of a question
   * it was never told was waiting.
   */
  it("should not report a question its viewer answered", () => {
    const { heard, observer } = recordingObserver();
    const world = createWorld({ agentRequests: observer });

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    world.harness().emit(frames.requestPermission(58, SESSION));
    alice.send(frames.permissionAnswer(58));

    expect(heard).toEqual([]);
  });
});
