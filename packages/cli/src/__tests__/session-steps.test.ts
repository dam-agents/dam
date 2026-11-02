import { describe, expect, it } from "vitest";

import {
  createStepLog,
  formatDuration,
} from "../modules/chat/domain/session-steps.js";

/**
 * TEST_OVERVIEW: How `dam session show` reads a Session Transcript into steps
 * (#6063). The person's and the agent's messages become one step per message,
 * however many chunks carry them. Each tool call becomes one step with its
 * tool, a summary of its input, its status and its duration. The duration
 * comes from the `_meta.platform.at` stamps of the frame that started the call
 * and the frame that finished it, because no harness reports one.
 */

function update(
  sessionUpdate: string,
  fields: Record<string, unknown>,
  at?: string,
) {
  return {
    sessionId: "s-1",
    update: { sessionUpdate, ...fields },
    ...(at !== undefined && { _meta: { platform: { at } } }),
  };
}

describe("session steps", () => {
  /**
   * TEST_SCENARIO: A Claude Code turn: the person asks, the agent answers in
   * two chunks of one message, then runs a Bash command for six minutes. The
   * user must see one line per message, and the Bash call with its command
   * and how long it ran, not the adapter's display title.
   */
  it("should join message chunks and time a tool call from its stamps", () => {
    const log = createStepLog();
    log.apply(
      update(
        "user_message_chunk",
        { content: { type: "text", text: "run the tests" }, messageId: "u1" },
        "2026-10-29T08:00:00.000Z",
      ),
    );
    log.apply(
      update(
        "agent_message_chunk",
        { content: { type: "text", text: "Running " }, messageId: "a1" },
        "2026-10-29T08:00:01.000Z",
      ),
    );
    log.apply(
      update(
        "agent_message_chunk",
        { content: { type: "text", text: "them now." }, messageId: "a1" },
        "2026-10-29T08:00:02.000Z",
      ),
    );
    log.apply(
      update(
        "tool_call",
        {
          toolCallId: "t1",
          title: "`mise run test`",
          kind: "execute",
          status: "pending",
          rawInput: { command: "mise run test", description: "Run tests" },
          _meta: { claudeCode: { toolName: "Bash" } },
        },
        "2026-10-29T08:00:03.000Z",
      ),
    );
    log.apply(
      update(
        "tool_call_update",
        { toolCallId: "t1", status: "in_progress" },
        "2026-10-29T08:00:04.000Z",
      ),
    );
    log.apply(
      update(
        "tool_call_update",
        { toolCallId: "t1", status: "completed" },
        "2026-10-29T08:06:03.000Z",
      ),
    );

    expect(log.steps).toEqual([
      {
        kind: "message",
        role: "user",
        text: "run the tests",
        at: "2026-10-29T08:00:00.000Z",
        messageId: "u1",
      },
      {
        kind: "message",
        role: "agent",
        text: "Running them now.",
        at: "2026-10-29T08:00:01.000Z",
        messageId: "a1",
      },
      {
        kind: "tool",
        toolCallId: "t1",
        tool: "Bash",
        summary: "mise run test",
        status: "completed",
        startedAt: "2026-10-29T08:00:03.000Z",
        endedAt: "2026-10-29T08:06:03.000Z",
        durationMs: 360_000,
      },
    ]);
  });

  /**
   * TEST_SCENARIO: A tool call still running, from a harness that names its
   * tools only in the title (an MCP tool), and a frame with no time stamp.
   * The step stays open with no duration, the tool is the MCP tool's name, and
   * a missing stamp leaves the time unknown instead of guessing it.
   */
  it("should leave a running tool call open and name an MCP tool", () => {
    const log = createStepLog();
    log.apply(
      update("tool_call", {
        toolCallId: "t2",
        title: "mcp__github__create_pull_request",
        status: "in_progress",
        rawInput: { title: "fix" },
      }),
    );

    expect(log.steps).toEqual([
      {
        kind: "tool",
        toolCallId: "t2",
        tool: "create_pull_request",
        summary: "mcp__github__create_pull_request",
        status: "in_progress",
        startedAt: null,
        endedAt: null,
        durationMs: null,
      },
    ]);
  });

  /**
   * TEST_SCENARIO: Thoughts, plans and an update for a tool call the log never
   * saw start are not steps, so they never print as empty lines.
   */
  it("should ignore thoughts, plans and orphan tool updates", () => {
    const log = createStepLog();
    expect(
      log.apply(
        update("agent_thought_chunk", { content: { type: "text", text: "…" } }),
      ),
    ).toBeNull();
    expect(log.apply(update("plan", { entries: [] }))).toBeNull();
    expect(
      log.apply(
        update("tool_call_update", { toolCallId: "gone", status: "completed" }),
      ),
    ).toBeNull();
    expect(log.steps).toEqual([]);
  });

  it("should format durations for a reader", () => {
    expect(formatDuration(450)).toBe("450ms");
    expect(formatDuration(42_000)).toBe("42s");
    expect(formatDuration(6 * 60_000 + 5_000)).toBe("6m05s");
    expect(formatDuration(64 * 60_000 + 16_000)).toBe("1h04m");
  });
});
