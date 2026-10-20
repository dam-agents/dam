import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { claudeSessionState } from "../../../domain/harness-state.js";
import { createActiveTurnStore } from "../../../infrastructure/active-turn-store.js";
import { createRunResultStore } from "../../../infrastructure/run-result-store.js";
import { createBackgroundWorkRegistry } from "../../background-work-registry.js";
import {
  createSessionMetadata,
  createWorld,
  frames,
  IDLE_REAP_DELAY_MS,
  keepsEveryTask,
  memoryDocumentBackend,
  sharedDocumentBackend,
  type Client,
  type Frame,
  type World,
} from "./acp-world.js";

/**
 * TEST_OVERVIEW: The harness keeps working after it answered a prompt.
 * Claude Code answers a prompt that started background agents, then runs an
 * Autonomous Turn of its own when the last of them reports: it handles the
 * reports and does the steps that follow. It says so in `_claude/sdkMessage`
 * notifications carrying `session_state_changed` (`running`, then `idle` once
 * nothing is left), which the runtime asks for with
 * `_meta.claudeCode.emitRawSDKMessages` on every session/new, session/load and
 * session/resume. While the harness is busy that way, the session is not
 * reaped, the runtime is busy, and the Active-Turn marker stays. A headless run
 * (`cli_run`) is still `pending`, and its record takes the text of the
 * Autonomous Turn too; once the harness is idle the record is written and
 * `platform/runEnded` names the prompt and the run's final stop reason.
 * A harness that never says idle is treated as idle after a quiet backstop.
 */

const SESSION = "sess-fanout";
const PRESUME_IDLE_MS = 60_000;
const STATE_FILTER = { type: "system", subtype: "session_state_changed" };

function harnessState(
  sessionId: string,
  state: "running" | "idle" | "requires_action",
): object {
  return {
    jsonrpc: "2.0",
    method: "_claude/sdkMessage",
    params: {
      sessionId,
      message: {
        type: "system",
        subtype: "session_state_changed",
        state,
        uuid: "u-1",
        session_id: sessionId,
      },
    },
  };
}

function toolCall(sessionId: string, toolCallId: string, status?: string) {
  return {
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId,
      update: {
        sessionUpdate: status === undefined ? "tool_call" : "tool_call_update",
        toolCallId,
        ...(status !== undefined && { status }),
      },
    },
  };
}

function runPrompt(id: number, text: string, promptId: string): object {
  return {
    jsonrpc: "2.0",
    id,
    method: "session/prompt",
    params: {
      sessionId: SESSION,
      prompt: [{ type: "text", text }],
      _meta: { platform: { promptId, surface: "cli" } },
    },
  };
}

function runResult(client: Client, id: number): unknown {
  client.send({
    jsonrpc: "2.0",
    id,
    method: "platform/runResult",
    params: { sessionId: SESSION },
  });
  return client.reply(id)?.result;
}

function rawMessagesAsked(frame: Frame | undefined): unknown {
  const params = frame?.params as
    { _meta?: { claudeCode?: { emitRawSDKMessages?: unknown } } } | undefined;
  return params?._meta?.claudeCode?.emitRawSDKMessages;
}

describe("acp-runtime: work the harness does after it answered a prompt", () => {
  let world: World;
  let runResults: ReturnType<typeof createRunResultStore>;
  let activeTurns: ReturnType<typeof createActiveTurnStore>;
  let logs: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    logs = [];
    runResults = createRunResultStore(memoryDocumentBackend());
    activeTurns = createActiveTurnStore(memoryDocumentBackend());
    world = createWorld({
      sessionMetadata: createSessionMetadata().store,
      runResults,
      activeTurns,
      harnessState: claudeSessionState,
      presumeIdleMs: PRESUME_IDLE_MS,
      log: (msg) => logs.push(msg),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function startRun(client: Client, promptId = "prompt-fanout"): void {
    client.send({
      jsonrpc: "2.0",
      id: 1,
      method: "session/new",
      params: {
        cwd: ".",
        _meta: { platform: { mode: "chat", type: "cli_run" } },
      },
    });
    world.harness().replyTo("session/new", { sessionId: SESSION });
    client.send(runPrompt(2, "fan out three agents", promptId));
    world.harness().emit(harnessState(SESSION, "running"));
  }

  /**
   * TEST_SCENARIO: The issue's race. Two of three background agents report,
   * Claude Code answers the prompt with end_turn, and it is still `running`:
   * the third report and the summary come in an Autonomous Turn. The run must
   * stay `pending` and the record must not be written at the prompt answer.
   * When the harness says idle, the record holds the text of both turns and
   * the prompt's stop reason, and `platform/runEnded` names the prompt.
   */
  it("should hold a headless run open until the harness is idle", () => {
    const client = world.connect();
    startRun(client);
    world.harness().emit(frames.agentMessage(SESSION, "A=1 B=2 "));
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    expect(runResult(client, 3)).toEqual({ status: "pending" });
    expect(runResults.readFor(SESSION)).toBeNull();
    expect(client.saw("platform/runEnded")).toEqual([]);

    world.harness().emit(frames.agentMessage(SESSION, "C=3. Sum is 6."));
    world.harness().emit(harnessState(SESSION, "idle"));

    expect(runResult(client, 4)).toEqual({
      status: "done",
      result: {
        promptId: "prompt-fanout",
        stopReason: "end_turn",
        finalText: "A=1 B=2 C=3. Sum is 6.",
        truncated: false,
        endedAt: expect.any(String) as string,
      },
    });
    expect(client.saw("platform/runEnded")).toEqual([
      {
        jsonrpc: "2.0",
        method: "platform/runEnded",
        params: expect.objectContaining({
          sessionId: SESSION,
          promptId: "prompt-fanout",
          stopReason: "end_turn",
        }) as object,
      },
    ]);
  });

  /**
   * TEST_SCENARIO: The second half of the issue: a few seconds after the run
   * ended, the platform closed the conversation and Claude Code read it as the
   * user interrupting. The idle reap must wait while the harness is busy,
   * whoever is attached, and close the session only after the idle report.
   */
  it("should not reap a session while the harness is busy", () => {
    const client = world.connect();
    startRun(client);
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });
    client.disconnect();

    vi.advanceTimersByTime(IDLE_REAP_DELAY_MS * 10);
    expect(world.harness().received("session/close")).toEqual([]);

    world.harness().emit(harnessState(SESSION, "idle"));
    vi.advanceTimersByTime(IDLE_REAP_DELAY_MS + 1);
    expect(
      world
        .harness()
        .received("session/close")
        .map((f) => f.params),
    ).toEqual([{ sessionId: SESSION }]);
  });

  /**
   * TEST_SCENARIO: The hold is not only for headless runs: an Autonomous Turn
   * after a chat prompt is work too, and the idle checker must not hibernate
   * the pod under it. The runtime is busy until the idle report, and a chat
   * session gets no run record.
   */
  it("should keep the runtime busy during an Autonomous Turn in any session", () => {
    const client = world.connect();
    client.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    client.send(frames.prompt(2, SESSION, "start the agents"));
    world.harness().emit(harnessState(SESSION, "running"));
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    expect(world.runtime.status().idle).toBe(false);

    world.harness().emit(harnessState(SESSION, "idle"));
    expect(world.runtime.status().idle).toBe(true);
    expect(runResults.readFor(SESSION)).toBeNull();
  });

  /**
   * TEST_SCENARIO: A harness that reports nothing, or a Claude Code session
   * that went idle before it answered, must end as before: the record is
   * written at the prompt answer and `platform/runEnded` follows it at once.
   */
  it("should end the run at the prompt answer when the harness is idle", () => {
    const client = world.connect();
    startRun(client);
    world.harness().emit(frames.agentMessage(SESSION, "done"));
    world.harness().emit(harnessState(SESSION, "idle"));
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    expect(runResults.readFor(SESSION)).toMatchObject({
      promptId: "prompt-fanout",
      stopReason: "end_turn",
      finalText: "done",
    });
    expect(client.saw("platform/runEnded")).toHaveLength(1);
  });

  /**
   * TEST_SCENARIO: `dam run cancel` during the Autonomous Turn cancels the
   * run, not only the prompt, which already ended with end_turn. The record
   * must carry the run's final outcome, `cancelled`.
   */
  it("should record a cancel during the Autonomous Turn as cancelled", () => {
    const client = world.connect();
    startRun(client);
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    client.send({
      jsonrpc: "2.0",
      method: "session/cancel",
      params: { sessionId: SESSION },
    });
    world.harness().emit(harnessState(SESSION, "idle"));

    expect(runResults.readFor(SESSION)?.stopReason).toBe("cancelled");
    expect(
      (client.saw("platform/runEnded")[0]?.params as { stopReason?: string })
        .stopReason,
    ).toBe("cancelled");
  });

  /**
   * TEST_SCENARIO: A pod that dies during the Autonomous Turn must resume it
   * on the next boot with the `<turn-interrupted>` notice, as it would a
   * prompt turn. So the Active-Turn marker outlives the prompt answer and
   * goes only at the idle report.
   */
  it("should keep the Active-Turn marker until the harness is idle", () => {
    const disk = sharedDocumentBackend();
    const seeded = createWorld({
      activeTurns: createActiveTurnStore(disk),
      harnessState: claudeSessionState,
    });
    const viewer = seeded.connect();
    viewer.send(frames.newSession(1));
    seeded.harness().replyTo("session/new", { sessionId: SESSION });
    viewer.send(frames.prompt(2, SESSION, "start the agents"));
    seeded.harness().emit(harnessState(SESSION, "running"));
    seeded.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    expect(
      createActiveTurnStore(disk)
        .leftovers()
        .map((m) => m.sessionId),
    ).toEqual([SESSION]);

    seeded.harness().emit(harnessState(SESSION, "idle"));
    expect(createActiveTurnStore(disk).leftovers()).toEqual([]);
  });

  /**
   * TEST_SCENARIO: An Autonomous Turn can start long after the last prompt,
   * when a background agent reports with nobody attached. It is work the pod
   * would lose in a crash, so a busy report with no prompt turn running writes
   * the Active-Turn marker, and the idle report removes it.
   */
  it("should mark an Autonomous Turn that starts after the prompt answer", () => {
    const disk = sharedDocumentBackend();
    const seeded = createWorld({
      activeTurns: createActiveTurnStore(disk),
      harnessState: claudeSessionState,
    });
    const viewer = seeded.connect();
    viewer.send(frames.newSession(1));
    seeded.harness().replyTo("session/new", { sessionId: SESSION });
    viewer.send(frames.prompt(2, SESSION, "start the agents"));
    seeded.harness().replyTo("session/prompt", { stopReason: "end_turn" });
    expect(createActiveTurnStore(disk).leftovers()).toEqual([]);

    seeded.harness().emit(harnessState(SESSION, "running"));
    expect(
      createActiveTurnStore(disk)
        .leftovers()
        .map((m) => m.sessionId),
    ).toEqual([SESSION]);

    seeded.harness().emit(harnessState(SESSION, "idle"));
    expect(createActiveTurnStore(disk).leftovers()).toEqual([]);
  });

  /**
   * TEST_SCENARIO: The harness dies during the Autonomous Turn. The run takes
   * the path of a dropped prompt turn: a record with no stop reason and the
   * text so far, and nothing holds the runtime busy for a harness that is
   * gone. The marker stays for boot recovery.
   */
  it("should record a run cut short by a harness death without a stop reason", async () => {
    const client = world.connect();
    startRun(client);
    world.harness().emit(frames.agentMessage(SESSION, "A=1 "));
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });
    world.harness().emit(frames.agentMessage(SESSION, "B=2 "));

    world.harness().exit();
    await vi.advanceTimersByTimeAsync(1);

    expect(runResults.readFor(SESSION)).toMatchObject({
      promptId: "prompt-fanout",
      stopReason: null,
      finalText: "A=1 B=2 ",
    });
    expect(world.runtime.status().idle).toBe(true);
  });

  /**
   * TEST_SCENARIO: Claude Code can lose its idle report. A session that stays
   * busy with no session/update, no open tool call and no reported background
   * work for the backstop period is treated as idle, with a warning, and the
   * run record gets the text so far and the prompt's stop reason.
   */
  it("should presume the harness idle after a quiet backstop", () => {
    const client = world.connect();
    startRun(client);
    world.harness().emit(frames.agentMessage(SESSION, "partial"));
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    vi.advanceTimersByTime(PRESUME_IDLE_MS - 1);
    expect(runResult(client, 3)).toEqual({ status: "pending" });

    vi.advanceTimersByTime(1);
    expect(runResults.readFor(SESSION)).toMatchObject({
      stopReason: "end_turn",
      finalText: "partial",
    });
    expect(logs.some((l) => l.includes("treating it as idle"))).toBe(true);
  });

  /**
   * TEST_SCENARIO: The backstop must not cut real work short. Output from the
   * harness restarts the quiet period, and an open tool call or reported
   * background work holds it off until they settle.
   */
  it("should hold the backstop off while the harness shows work", () => {
    const backgroundWork = createBackgroundWorkRegistry({
      keepPolicy: keepsEveryTask,
    });
    const busy = createWorld({
      sessionMetadata: createSessionMetadata().store,
      runResults,
      harnessState: claudeSessionState,
      presumeIdleMs: PRESUME_IDLE_MS,
      backgroundWork,
    });
    const client = busy.connect();
    client.send(frames.newSession(1));
    busy.harness().replyTo("session/new", { sessionId: SESSION });
    client.send(runPrompt(2, "fan out", "prompt-long"));
    busy.harness().emit(harnessState(SESSION, "running"));
    busy.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    vi.advanceTimersByTime(PRESUME_IDLE_MS - 1);
    busy.harness().emit(frames.agentMessage(SESSION, "still going"));
    vi.advanceTimersByTime(PRESUME_IDLE_MS - 1);
    expect(runResults.readFor(SESSION)).toBeNull();

    busy.harness().emit(toolCall(SESSION, "tc-sleep"));
    vi.advanceTimersByTime(PRESUME_IDLE_MS * 3);
    expect(runResults.readFor(SESSION)).toBeNull();

    busy.harness().emit(toolCall(SESSION, "tc-sleep", "completed"));
    backgroundWork.report(SESSION, [{ id: "agent-c", description: "agent C" }]);
    vi.advanceTimersByTime(PRESUME_IDLE_MS * 3);
    expect(runResults.readFor(SESSION)).toBeNull();

    backgroundWork.report(SESSION, []);
    vi.advanceTimersByTime(PRESUME_IDLE_MS);
    expect(runResults.readFor(SESSION)?.finalText).toBe("still going");
  });

  /**
   * TEST_SCENARIO: The runtime learns the harness state only if it asks for
   * it. Every frame that opens a session in the harness — session/new from a
   * client, a cold session/load, a rehydrating load — carries the
   * `session_state_changed` filter, beside any filter the client sent itself.
   */
  it("should ask the harness for its session state on every session it opens", () => {
    const client = world.connect();
    client.send({
      jsonrpc: "2.0",
      id: 1,
      method: "session/new",
      params: {
        cwd: ".",
        _meta: {
          claudeCode: { emitRawSDKMessages: [{ type: "result" }] },
        },
      },
    });
    expect(
      rawMessagesAsked(world.harness().received("session/new")[0]),
    ).toEqual([{ type: "result" }, STATE_FILTER]);

    client.send(frames.loadSession(2, "sess-cold"));
    expect(
      rawMessagesAsked(world.harness().received("session/load")[0]),
    ).toEqual([STATE_FILTER]);
  });

  /**
   * TEST_SCENARIO: The state notification is the runtime's own signal, not
   * conversation content: it must not reach a viewer, nor the Session
   * Transcript a later viewer replays.
   */
  it("should keep the state notifications out of the transcript", () => {
    const client = world.connect();
    startRun(client);
    world.harness().emit(harnessState(SESSION, "idle"));

    expect(client.saw("_claude/sdkMessage")).toEqual([]);
    expect(
      world.runtime
        .sessionFrames(SESSION)
        .frames.some((line) => line.includes("_claude/sdkMessage")),
    ).toBe(false);
  });
});
