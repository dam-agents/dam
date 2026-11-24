import type { ApprovalView, McpToolCallPayload } from "api-server-api";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ToolCallApproval } from "../../modules/approvals/components/tool-call-approval.js";
import { timeLeftText } from "../../modules/approvals/lib/time-left.js";
import { toolCallArgumentRows } from "../../modules/approvals/lib/tool-call-argument-rows.js";
import {
  type ToolCallCardContext,
  toolCallCardCopy,
} from "../../modules/approvals/lib/tool-call-card-copy.js";

// TEST_OVERVIEW: a held tool call shows as one card that reads as what it will do, the same in the chat and on Home. A Slack post, a thread reply, a scheduled message and a draft each have their own title ("Standup writer wants to post in #launch-team"), the account the call acts as, stamps for when and how it goes out, buttons that name the action ("Post" / "Don't post") and the line shown after the answer. A tool with no renderer says it wants to use the tool, lists its arguments as names and values and keeps "Allow once" / "Deny". The card counts down to the refusal from the approval's `expiresAt`, and keeps the Connection, the exact tool and the raw arguments behind "Details".

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactElement }) => children,
}));

vi.mock("../../modules/connections/components/connection-icon.js", () => ({
  ConnectionIcon: () => null,
}));

vi.mock("../../modules/approvals/hooks/use-tool-call-account.js", () => ({
  useToolCallAccount: () => ({
    actor: "you",
    accountLabel: "Tomáš Weiss (apoco)",
  }),
}));

const { actions } = vi.hoisted(() => {
  const answer = (id: "allow-once" | "dismiss", label: string) => ({
    id,
    label,
    icon: () => null,
    danger: id === "dismiss",
    disabled: false,
    resolvedLabel: label,
    run: () => Promise.resolve(true),
  });
  return {
    actions: [answer("allow-once", "Allow once"), answer("dismiss", "Deny")],
  };
});

vi.mock("../../modules/approvals/hooks/use-approval-actions.js", () => ({
  useApprovalActions: () => ({
    actions,
    primary: "allow-once",
    inflight: false,
    hostLabel: null,
    expiredNote: null,
    openSettings: () => {},
  }),
}));

const OWNER: ToolCallCardContext = {
  agentName: "Standup writer",
  actor: "you",
  accountLabel: "Tomáš Weiss (apoco)",
};

function slackCall(
  tool: string,
  args: Record<string, unknown>,
  targetLabel: string | null = "#launch-team",
): McpToolCallPayload {
  return {
    kind: "mcp_tool_call",
    connectionId: "conn-slack",
    connectionName: "slack-account",
    templateId: "slack",
    tool,
    key: "k1",
    arguments: args,
    argumentsBytes: JSON.stringify(args).length,
    ...(targetLabel ? { targetLabel } : {}),
  };
}

function genericCall(args: unknown): McpToolCallPayload {
  return {
    kind: "mcp_tool_call",
    connectionId: "conn-linear",
    connectionName: "linear-mcp",
    templateId: null,
    tool: "create_issue",
    key: "k2",
    arguments: args,
    argumentsBytes: JSON.stringify(args).length,
  };
}

const titleOf = (payload: McpToolCallPayload, context = OWNER) => {
  const { title } = toolCallCardCopy(payload, context);
  return [context.agentName, title.verb, title.object]
    .filter((part) => part !== null)
    .join(" ");
};

const POST = { channel_id: "C07LAUNCH", message: "Hi" };

describe("the card of a Slack message", () => {
  // TEST_SCENARIO: a post says who wants to post where, as which account, that it goes out now, and names the action on both buttons and in the line after the answer.
  it("reads a post as the message it sends", () => {
    const copy = toolCallCardCopy(slackCall("slack_send_message", POST), OWNER);
    expect(titleOf(slackCall("slack_send_message", POST))).toBe(
      "Standup writer wants to post in #launch-team",
    );
    expect(copy.subtitle).toBe("As you, Tomáš Weiss (apoco)");
    expect(copy.stamps).toEqual(["Goes out now"]);
    expect(copy.allow).toEqual({
      label: "Post",
      done: "Posted in #launch-team as you",
    });
    expect(copy.deny).toEqual({
      label: "Don't post",
      done: "Not posted. Standup writer was told.",
    });
  });

  // TEST_SCENARIO: a reply says it goes in a thread, and one also sent to the channel says so too.
  it("says a reply goes in a thread", () => {
    const reply = slackCall("slack_send_message", {
      ...POST,
      thread_ts: "1795514400.004200",
      reply_broadcast: true,
    });
    expect(titleOf(reply)).toBe(
      "Standup writer wants to reply in a thread in #launch-team",
    );
    const copy = toolCallCardCopy(reply, OWNER);
    expect(copy.stamps).toEqual([
      "Goes out now",
      "In a thread",
      "Also sent to the conversation",
    ]);
    expect(copy.allow.done).toBe("Posted in a thread in #launch-team as you");
  });

  // TEST_SCENARIO: a scheduled reply says when it goes out, in its stamp and in the line after the answer, and its buttons say schedule.
  it("says when a scheduled message goes out", () => {
    const scheduled = slackCall("slack_schedule_message", {
      ...POST,
      thread_ts: "1795514400.004200",
      post_at: 1_795_597_200,
    });
    expect(titleOf(scheduled)).toBe(
      "Standup writer wants to schedule a reply in a thread in #launch-team",
    );
    const copy = toolCallCardCopy(scheduled, OWNER);
    const when = copy.stamps[0]!.replace(/^Goes out /, "");
    expect(copy.stamps).toEqual([`Goes out ${when}`, "In a thread"]);
    expect(when).not.toBe("");
    expect(copy.allow).toEqual({
      label: "Schedule",
      done: `Scheduled for ${when} in a thread in #launch-team`,
    });
    expect(copy.deny).toEqual({
      label: "Don't schedule",
      done: "Not scheduled. Standup writer was told.",
    });
  });

  // TEST_SCENARIO: a draft says it is saved as a draft and not sent, and its buttons say save.
  it("says a draft is saved, not sent", () => {
    const draft = slackCall("slack_send_message_draft", POST);
    expect(titleOf(draft)).toBe(
      "Standup writer wants to save a draft in #launch-team",
    );
    const copy = toolCallCardCopy(draft, OWNER);
    expect(copy.stamps).toEqual(["Saved as a draft, not sent"]);
    expect(copy.allow).toEqual({
      label: "Save draft",
      done: "Saved as a draft in #launch-team",
    });
    expect(copy.deny).toEqual({
      label: "Don't save",
      done: "Not saved. Standup writer was told.",
    });
  });

  // TEST_SCENARIO: a direct message names the person, by the name the api-server looked up, else by the Slack id.
  it("names the person of a direct message", () => {
    expect(
      titleOf(
        slackCall(
          "slack_send_message",
          { channel_id: "D0789", message: "hi" },
          "Jane Doe",
        ),
      ),
    ).toBe("Standup writer wants to send a direct message to Jane Doe");
    expect(
      titleOf(
        slackCall(
          "slack_send_message",
          { channel_id: "C0CL63K6FKL", message: "hi" },
          null,
        ),
      ),
    ).toBe("Standup writer wants to post in C0CL63K6FKL");
  });

  // TEST_SCENARIO: without the account label, the line names the Connection; an Agent Editor sees the owner's email where the owner sees "you", since the call runs with the owner's Connection.
  it("names the account the call acts as", () => {
    const post = slackCall("slack_send_message", POST);
    expect(
      toolCallCardCopy(post, { ...OWNER, accountLabel: null }).subtitle,
    ).toBe("On slack-account, as you");
    const editor = { ...OWNER, actor: "jordan@example.com" };
    expect(toolCallCardCopy(post, editor).subtitle).toBe(
      "On slack-account, as jordan@example.com",
    );
    expect(toolCallCardCopy(post, editor).allow.done).toBe(
      "Posted in #launch-team as jordan@example.com",
    );
  });

  // TEST_SCENARIO: once the arguments are gone or not in the expected shape, the card still names the action from the tool and keeps its buttons, with no target and no stamps.
  it("keeps the action when the message is not readable", () => {
    const shapeless = slackCall("slack_send_message", { channel: "C1" });
    expect(titleOf(shapeless)).toBe(
      "Standup writer wants to send a Slack message",
    );
    const copy = toolCallCardCopy(shapeless, OWNER);
    expect(copy.stamps).toEqual([]);
    expect(copy.allow).toEqual({ label: "Post", done: "Posted as you" });
  });
});

describe("the card of a tool with no renderer", () => {
  // TEST_SCENARIO: the card says the agent wants to use the tool on its Connection, and keeps "Allow once" and "Deny".
  it("keeps Allow once and Deny", () => {
    const copy = toolCallCardCopy(genericCall({ title: "x" }), OWNER);
    expect(titleOf(genericCall({ title: "x" }))).toBe(
      "Standup writer wants to use create_issue",
    );
    expect(copy.subtitle).toBe("On linear-mcp, as you");
    expect(copy.stamps).toEqual([]);
    expect(copy.allow).toEqual({
      label: "Allow once",
      done: "Allowed once: create_issue",
    });
    expect(copy.deny).toEqual({
      label: "Deny",
      done: "Denied. Standup writer was told.",
    });
  });

  // TEST_SCENARIO: the arguments show as names and values; a string or number as it is, any other value as JSON; arguments that are not named values have no rows.
  it("lists the arguments as names and values", () => {
    expect(
      toolCallArgumentRows({
        title: "Broken build",
        priority: 2,
        labels: ["ci"],
        draft: false,
      }),
    ).toEqual([
      { name: "title", value: "Broken build", json: false },
      { name: "priority", value: "2", json: false },
      { name: "labels", value: '[\n  "ci"\n]', json: true },
      { name: "draft", value: "false", json: true },
    ]);
    expect(toolCallArgumentRows(["a"])).toBeNull();
    expect(toolCallArgumentRows("text")).toBeNull();
  });
});

describe("the time left before the refusal", () => {
  const now = new Date("2026-11-24T12:00:00Z");

  // TEST_SCENARIO: the clock counts minutes and seconds, adds hours for a long hold, and is gone once the time is up.
  it("counts down to expiresAt", () => {
    expect(timeLeftText("2026-11-24T12:04:12Z", now)).toBe("4:12");
    expect(timeLeftText("2026-11-24T12:00:00.400Z", now)).toBe("0:01");
    expect(timeLeftText("2026-11-24T13:04:05Z", now)).toBe("1:04:05");
    expect(timeLeftText("2026-11-24T12:00:00Z", now)).toBeNull();
    expect(timeLeftText("2026-11-24T11:00:00Z", now)).toBeNull();
  });
});

describe("the card on the page", () => {
  const approval = (payload: McpToolCallPayload): ApprovalView => ({
    id: "tc-1",
    type: "mcp_tool_call",
    agentId: "a-1",
    sessionId: null,
    payload,
    createdAt: "2026-11-24T11:59:00Z",
    expiresAt: "2999-01-01T00:00:00Z",
    resolvedAt: null,
    verdict: null,
    status: "pending",
  });
  const render = (payload: McpToolCallPayload) =>
    renderToStaticMarkup(
      createElement(ToolCallApproval, {
        approval: approval(payload),
        payload,
        ids: ["tc-1"],
        agentName: "Standup writer",
        onAnswered: () => {},
      }),
    );

  // TEST_SCENARIO: a Slack post shows its title, the message under the account name with its marks, the countdown and the named buttons; the tool name and raw arguments stay closed behind Details.
  it("shows a Slack post as the message", () => {
    const markup = render(
      slackCall("slack_send_message", {
        channel_id: "C07LAUNCH",
        message: "**Standup**",
      }),
    );
    expect(markup).toContain(
      '<strong class="font-semibold">Standup writer</strong> wants to post in',
    );
    expect(markup).toContain("As you, Tomáš Weiss (apoco)");
    expect(markup).toContain("Refused in");
    expect(markup).toContain(">Tomáš Weiss (apoco)</span>");
    expect(markup).toContain('<strong class="font-semibold">Standup</strong>');
    expect(markup).toContain(">Post</button>");
    expect(markup).toContain(">Don&#x27;t post</button>");
    expect(markup).toContain("Details");
    expect(markup).not.toContain("slack_send_message");
    expect(markup).not.toContain("C07LAUNCH");
  });

  // TEST_SCENARIO: a tool with no renderer lists its arguments by name and keeps Allow once and Deny.
  it("lists a generic call's arguments", () => {
    const markup = render(
      genericCall({ title: "Broken build", labels: ["ci"] }),
    );
    expect(markup).toContain('data-testid="tool-call-arguments"');
    expect(markup).toContain(">title</dt>");
    expect(markup).toContain(">Broken build</dd>");
    expect(markup).toContain(">Allow once</button>");
    expect(markup).toContain(">Deny</button>");
  });
});
