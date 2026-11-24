import {
  type ApprovalView,
  MCP_TOOL_CALL_ARGUMENTS_MAX_BYTES,
  type McpToolCallPayload,
} from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  approvalGroupKey,
  groupBy,
} from "../../modules/approvals/lib/group-approvals.js";
import { toolCallArgumentsOf } from "../../modules/approvals/lib/tool-call-arguments.js";
import { templateToolCallOf } from "../../modules/approvals/lib/tool-call-renderers.js";
import { egressApprovalsWaiting } from "../../modules/approvals/lib/waiting-egress.js";
import {
  approvalDetail,
  approvalHeadline,
  approvalPromptTitle,
  approvalToolCallSource,
} from "../../modules/home/lib/approval-copy.js";

// TEST_OVERVIEW: a held MCP tool call where the owner meets it: in the agent's chat beside its waiting network approvals, and on Home. It names the tool and the Connection and shows the call's arguments: whole as JSON, cut with a note that says how much is shown, or gone once the approval settled, with why. A Slack Account call that posts, saves a draft or schedules a message reads as what it does, with the Slack logo, and shows the message it sends; it still names the Connection and the exact tool, and falls back to the generic view when its arguments are not in the expected shape. Any other tool keeps the generic copy. Two requests for the same call are one approval with a count.

const NOW = new Date("2026-11-20T12:00:00Z");

function payload(
  overrides: Partial<McpToolCallPayload> = {},
): McpToolCallPayload {
  return {
    kind: "mcp_tool_call",
    connectionId: "conn-1",
    connectionName: "Issue Tracker",
    templateId: null,
    tool: "create_issue",
    key: "k1",
    arguments: { title: "Broken build" },
    argumentsBytes: 24,
    ...overrides,
  };
}

function toolCall(
  overrides: Partial<ApprovalView> = {},
  call: Partial<McpToolCallPayload> = {},
): ApprovalView {
  return {
    id: "tc-1",
    type: "mcp_tool_call",
    agentId: "a-1",
    sessionId: null,
    payload: payload(call),
    createdAt: "2026-11-20T11:59:00Z",
    expiresAt: "2026-11-20T12:20:00Z",
    resolvedAt: null,
    verdict: null,
    status: "pending",
    ...overrides,
  };
}

describe("a held tool call", () => {
  // TEST_SCENARIO: the approval names the tool and the Connection it runs on.
  it("reads as a tool call on its Connection", () => {
    const approval = toolCall();
    expect(approvalHeadline(approval)).toBe(
      "Wants to use create_issue on Issue Tracker",
    );
    expect(approvalPromptTitle(approval)).toBe("Allow this tool call?");
    expect(approvalDetail(approval)).toBe("create_issue on Issue Tracker");
  });

  // TEST_SCENARIO: the chat shows a waiting tool call beside the network approvals, and one from a scoped child on its parent's page.
  it("waits in the agent's chat", () => {
    const own = toolCall();
    const child = toolCall(
      { id: "tc-child", agentId: "child-1" },
      { key: "k2", forAgentId: "a-1" },
    );
    expect(egressApprovalsWaiting([own, child], "a-1", NOW)).toEqual([
      own,
      child,
    ]);
  });

  // TEST_SCENARIO: two requests for the same call share a key and are one approval with a count; a call with other arguments has another key and is its own.
  it("groups the same call together", () => {
    const groups = groupBy(
      [
        toolCall({ id: "a" }),
        toolCall({ id: "b" }),
        toolCall({ id: "c" }, { key: "k3" }),
      ],
      approvalGroupKey,
    );
    expect(groups.map((g) => g.map((a) => a.id))).toEqual([["a", "b"], ["c"]]);
  });
});

describe("the arguments of a tool call", () => {
  // TEST_SCENARIO: arguments within the limit show whole, as pretty-printed JSON.
  it("shows whole arguments as JSON", () => {
    expect(toolCallArgumentsOf(payload(), "pending")).toEqual({
      kind: "whole",
      value: { title: "Broken build" },
      json: '{\n  "title": "Broken build"\n}',
    });
  });

  // TEST_SCENARIO: above the limit the api-server keeps only the first part of the JSON text, which does not parse, so the view shows that text as it is and says how much of how much it shows.
  it("says the arguments were cut and how large they are", () => {
    const args = toolCallArgumentsOf(
      payload({
        arguments: '{"text":"aaaa',
        argumentsBytes: MCP_TOOL_CALL_ARGUMENTS_MAX_BYTES * 3,
      }),
      "pending",
    );
    expect(args).toEqual({
      kind: "cut",
      text: '{"text":"aaaa',
      note: "The arguments were cut: only the first 64 KiB of 192 KiB are shown.",
    });
  });

  // TEST_SCENARIO: the api-server drops the arguments when the approval settles, so a settled approval shows none and says why; a call that sent no arguments says that instead.
  it("says why settled arguments are gone", () => {
    const settled = payload({ arguments: undefined });
    expect(toolCallArgumentsOf(settled, "resolved")).toEqual({
      kind: "gone",
      why: "The arguments are no longer kept because this call was answered.",
    });
    expect(toolCallArgumentsOf(settled, "expired")).toEqual({
      kind: "gone",
      why: "The arguments are no longer kept because this call's hold ended.",
    });
    expect(
      toolCallArgumentsOf(
        payload({ arguments: undefined, argumentsBytes: 0 }),
        "resolved",
      ),
    ).toEqual({ kind: "none" });
  });
});

describe("a Slack tool call", () => {
  const slack = (tool: string, args: unknown) =>
    payload({
      templateId: "slack",
      connectionName: "slack-account",
      tool,
      arguments: args,
      argumentsBytes: JSON.stringify(args).length,
    });
  const messageOf = (tool: string, args: unknown) =>
    templateToolCallOf(slack(tool, args))?.message;

  // TEST_SCENARIO: each Slack tool that writes a message gets its own plain headline, the chat title asks the same as a question, and a quiet line still names the Connection and the exact tool.
  it("reads as what the call does, not as the raw tool name", () => {
    const post = toolCall(
      {},
      slack("slack_send_message", { channel_id: "C0123", message: "42" }),
    );
    expect(approvalHeadline(post)).toBe("Wants to send a Slack message");
    expect(approvalPromptTitle(post)).toBe("Send a Slack message?");
    expect(templateToolCallOf(slack("slack_send_message", {}))).toMatchObject({
      iconSlug: "slack",
      verb: "post",
    });
    expect(approvalToolCallSource(post)).toBe(
      "slack-account · slack_send_message",
    );

    const headlineOf = (tool: string, args: unknown) =>
      approvalHeadline(toolCall({}, slack(tool, args)));
    expect(
      headlineOf("slack_send_message", {
        channel_id: "C0123",
        message: "42",
        thread_ts: "1700000000.000100",
      }),
    ).toBe("Wants to reply in a Slack thread");
    expect(
      headlineOf("slack_schedule_message", {
        channel_id: "C0123",
        message: "later",
        post_at: 1_800_000_000,
      }),
    ).toBe("Wants to schedule a Slack message");
    expect(
      headlineOf("slack_send_message_draft", {
        channel_id: "C0123",
        message: "draft",
      }),
    ).toBe("Wants to save a Slack draft");
  });

  // TEST_SCENARIO: the headline comes from the tool, so it stays once the approval settles and its arguments are gone; only the message is missing then.
  it("keeps its headline when the arguments are gone", () => {
    const gone = payload({
      templateId: "slack",
      connectionName: "slack-account",
      tool: "slack_send_message",
      arguments: undefined,
    });
    const settled = toolCall({ status: "resolved", payload: gone });
    expect(approvalHeadline(settled)).toBe("Wants to send a Slack message");
    expect(templateToolCallOf(gone)?.message).toBeNull();
  });

  // TEST_SCENARIO: a Slack post shows its target, whether it goes to a thread, and its text as written.
  it("shows a post as the message it sends", () => {
    expect(
      messageOf("slack_send_message", {
        channel_id: "C0123",
        message: "Line one\nLine two",
        thread_ts: "1700000000.000100",
        reply_broadcast: true,
      }),
    ).toEqual({
      kind: "slack-message",
      delivery: { kind: "post" },
      target: { kind: "conversation", id: "C0123", label: null },
      threadTs: "1700000000.000100",
      alsoToChannel: true,
      text: "Line one\nLine two",
    });
  });

  // TEST_SCENARIO: a user id as the channel, or the id of a direct message conversation, is a direct message to that person.
  it("names a person as the target of a direct message", () => {
    expect(
      messageOf("slack_send_message", { channel_id: "U0456", message: "hi" }),
    ).toMatchObject({
      target: { kind: "person", id: "U0456" },
      threadTs: null,
      alsoToChannel: false,
    });
    expect(
      messageOf("slack_send_message", { channel_id: "D0789", message: "hi" }),
    ).toMatchObject({ target: { kind: "person", id: "D0789" } });
  });

  // TEST_SCENARIO: a scheduled post shows when it goes out.
  it("shows when a scheduled post goes out", () => {
    expect(
      messageOf("slack_schedule_message", {
        channel_id: "C0123",
        message: "later",
        post_at: 1_800_000_000,
      }),
    ).toMatchObject({
      delivery: { kind: "scheduled", at: new Date(1_800_000_000_000) },
    });
  });

  // TEST_SCENARIO: the Slack tool names and arguments were never read from Slack's server, so a known tool without the expected arguments shows the generic JSON under its own headline.
  it("falls back to the JSON when the arguments are not in the expected shape", () => {
    expect(messageOf("slack_send_message", { channel: "C1" })).toBeNull();
    expect(
      messageOf("slack_schedule_message", {
        channel_id: "C1",
        message: "no time",
      }),
    ).toBeNull();
  });

  // TEST_SCENARIO: any other Slack tool, and the same tool name on a Connection with no Template renderer, keep the generic headline, title and detail with no logo.
  it("keeps the generic copy for a tool with no renderer", () => {
    const reaction = toolCall(
      {},
      slack("slack_add_reaction", { channel_id: "C1", message: "x" }),
    );
    expect(
      templateToolCallOf(
        slack("slack_add_reaction", { channel_id: "C1", message: "x" }),
      ),
    ).toBeNull();
    expect(approvalHeadline(reaction)).toBe(
      "Wants to use slack_add_reaction on slack-account",
    );
    expect(approvalPromptTitle(reaction)).toBe("Allow this tool call?");
    expect(approvalDetail(reaction)).toBe(
      "slack_add_reaction on slack-account",
    );

    const untemplated = toolCall(
      {},
      {
        tool: "slack_send_message",
        arguments: { channel_id: "C1", message: "x" },
      },
    );
    expect(
      templateToolCallOf(
        payload({
          tool: "slack_send_message",
          arguments: { channel_id: "C1", message: "x" },
        }),
      ),
    ).toBeNull();
    expect(approvalHeadline(untemplated)).toBe(
      "Wants to use slack_send_message on Issue Tracker",
    );
  });
});
