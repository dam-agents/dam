import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DocumentStoreBackend } from "../../../../../core/document-store.js";
import { createRunResultStore } from "../../../infrastructure/run-result-store.js";
import {
  createSessionMetadata,
  createWorld,
  frames,
  IDLE_REAP_DELAY_MS,
  type Client,
  type World,
} from "./acp-world.js";

/**
 * TEST_OVERVIEW: Headless runs (`dam run`). A Session tagged `cli_run` records the outcome
 * of each finished turn — promptId, stopReason, and the assistant text the
 * turn streamed — in the Run Result store, which lives outside the in-memory
 * Session Transcript so the record survives the idle reap. Any client can read
 * it back with the `platform/runResult` extension method: `pending` while the
 * turn runs, `done` with the record after, `none` where nothing was recorded.
 * The synthetic `platform/turnEnded` notification carries the promptId and
 * stopReason so a reconnecting headless client can match its own turn.
 */

const SESSION = "sess-run";

function inMemoryBackend(): DocumentStoreBackend {
  return {
    open(_name, opts) {
      let state = opts.initial();
      return {
        read: () => state,
        write(next) {
          state = next;
        },
      };
    },
  };
}

function newRunSession(id: number): object {
  return {
    jsonrpc: "2.0",
    id,
    method: "session/new",
    params: {
      cwd: ".",
      _meta: { platform: { mode: "chat", type: "cli_run" } },
    },
  };
}

function promptWithId(
  id: number,
  sessionId: string,
  text: string,
  promptId: string,
): object {
  return {
    jsonrpc: "2.0",
    id,
    method: "session/prompt",
    params: {
      sessionId,
      prompt: [{ type: "text", text }],
      _meta: { platform: { promptId, surface: "cli" } },
    },
  };
}

function runResultRequest(id: number, sessionId: string): object {
  return {
    jsonrpc: "2.0",
    id,
    method: "platform/runResult",
    params: { sessionId },
  };
}

describe("acp-runtime: headless runs", () => {
  let world: World;
  let runResults: ReturnType<typeof createRunResultStore>;

  beforeEach(() => {
    vi.useFakeTimers();
    runResults = createRunResultStore(inMemoryBackend());
    world = createWorld({
      sessionMetadata: createSessionMetadata().store,
      runResults,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function startRun(client: Client, promptId = "prompt-1"): void {
    client.send(newRunSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    client.send(promptWithId(2, SESSION, "summarize", promptId));
  }

  /**
   * TEST_SCENARIO: A `cli_run` turn ends and its record must outlive the Session Transcript:
   * the client disconnects, the idle reap forgets the session, and a fresh
   * client still reads the full assistant text and stopReason via
   * `platform/runResult`.
   */
  it("should serve the recorded result after the idle reap", () => {
    const client = world.connect();
    startRun(client);
    world.harness().emit(frames.agentMessage(SESSION, "it is "));
    world.harness().emit(frames.agentMessage(SESSION, "a monorepo"));
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    client.disconnect();
    vi.advanceTimersByTime(IDLE_REAP_DELAY_MS + 1);

    const later = world.connect();
    later.send(runResultRequest(9, SESSION));
    expect(later.reply(9)?.result).toEqual({
      status: "done",
      result: {
        promptId: "prompt-1",
        stopReason: "end_turn",
        finalText: "it is a monorepo",
        truncated: false,
        endedAt: expect.any(String) as string,
      },
    });
  });

  /**
   * TEST_SCENARIO: While the turn is still in flight, `platform/runResult` must answer
   * `pending` — not `none`, which would read as "this run never happened" —
   * and a session nothing was recorded for answers `none`.
   */
  it("should answer pending during the turn and none for unknown sessions", () => {
    const client = world.connect();
    startRun(client);

    client.send(runResultRequest(3, SESSION));
    expect(client.reply(3)?.result).toEqual({ status: "pending" });

    client.send(runResultRequest(4, "sess-unknown"));
    expect(client.reply(4)?.result).toEqual({ status: "none" });
  });

  /**
   * TEST_SCENARIO: A reconnecting headless client can only claim a turn as its own if the
   * turn-end signal names the prompt. The synthetic `platform/turnEnded` must
   * carry the promptId the client minted and the harness's stopReason.
   */
  it("should stamp promptId and stopReason on the turn-ended notification", () => {
    const client = world.connect();
    startRun(client, "prompt-abc");
    world.harness().replyTo("session/prompt", { stopReason: "cancelled" });

    expect(client.saw("platform/turnEnded")).toEqual([
      {
        jsonrpc: "2.0",
        method: "platform/turnEnded",
        params: {
          sessionId: SESSION,
          promptId: "prompt-abc",
          stopReason: "cancelled",
        },
      },
    ]);
  });

  /**
   * TEST_SCENARIO: Only `cli_run` Sessions pay for run records. A regular chat turn must
   * leave nothing in the store.
   */
  it("should record nothing for sessions that are not cli_run", () => {
    const client = world.connect();
    client.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    client.send(frames.prompt(2, SESSION, "hello"));
    world.harness().emit(frames.agentMessage(SESSION, "hi"));
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    expect(runResults.readFor(SESSION)).toBeNull();
  });

  /**
   * TEST_SCENARIO: Deleting a Session removes everything the platform holds for it; a
   * record left behind would resurrect a conversation the user deleted.
   */
  it("should forget the record when the session is deleted", () => {
    const client = world.connect();
    startRun(client);
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });
    expect(runResults.readFor(SESSION)).not.toBeNull();

    client.send({
      jsonrpc: "2.0",
      id: 5,
      method: "platform/deleteSession",
      params: { sessionId: SESSION },
    });
    expect(runResults.readFor(SESSION)).toBeNull();
  });
});
