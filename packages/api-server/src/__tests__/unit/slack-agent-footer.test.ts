import { describe, it, expect } from "vitest";
import {
  agentContextBlock,
  agentFooterLabel,
  agentFooterMrkdwn,
  formatSlackTs,
  labelHistoryMessage,
  parseAgentFooter,
  type AgentFooter,
} from "../../modules/channels/infrastructure/agent-footer.js";
import { renderAssistantBlocks } from "../../modules/channels/infrastructure/slack-turn-presenter.js";
import type { SlackMessage } from "../../modules/channels/infrastructure/slack-gateway.js";

/**
 * TEST_OVERVIEW: The Agent Footer under every agent post in Slack has two
 * separable parts. The agent id in the URL is the wire format: the worker parses
 * it back out of channel history to attribute each line to the agent that wrote
 * it. The link label is presentation only, so product may reword it without
 * breaking attribution. These specs pin that split — parsing recovers an id and
 * never a name — plus the legacy URL forms already posted in every channel.
 */

const footer: AgentFooter = {
  uiBaseUrl: "http://ui",
  agentId: "agent-8acde0e1a059835a",
  label: "Powered by DAM",
};

const NO_BOT = { userId: null, label: "the DAM bot (unattributed)" };

function contextText(text: string): SlackMessage {
  return {
    blocks: [{ type: "context", elements: [{ type: "mrkdwn", text }] }],
  };
}

describe("agent footer", () => {
  it("takes its label from the brand", () => {
    expect(agentFooterLabel({ name: "DAM" })).toBe("Powered by DAM");
  });

  it("links the label at the agent's public page", () => {
    expect(agentFooterMrkdwn(footer)).toBe(
      "<http://ui/a/agent-8acde0e1a059835a|Powered by DAM>",
    );
  });

  it("carries the session as a query param when the post belongs to a turn", () => {
    expect(agentFooterMrkdwn({ ...footer, sessionId: "sess-42" })).toBe(
      "<http://ui/a/agent-8acde0e1a059835a?s=sess-42|Powered by DAM>",
    );
  });

  it("url-encodes a session id that would break the link", () => {
    expect(agentFooterMrkdwn({ ...footer, sessionId: "a/b c" })).toBe(
      "<http://ui/a/agent-8acde0e1a059835a?s=a%2Fb%20c|Powered by DAM>",
    );
  });

  /**
   * TEST_SCENARIO: The label is brand copy from Helm values, so an operator can
   * put a pipe or an angle bracket in it. Slack's <url|label> syntax would then
   * split at the wrong place and the whole footer would stop parsing.
   */
  it("sanitizes a label that would break the <url|label> syntax", () => {
    expect(agentFooterMrkdwn({ ...footer, label: "a|b <c> & d\nnext" })).toBe(
      "<http://ui/a/agent-8acde0e1a059835a|a b &lt;c&gt; &amp; d next>",
    );
  });

  it("falls back to the id as link text when the label is empty", () => {
    expect(agentFooterMrkdwn({ ...footer, label: "" })).toBe(
      "<http://ui/a/agent-8acde0e1a059835a|agent-8acde0e1a059835a>",
    );
  });

  it("round-trips the agent id through the context block", () => {
    expect(parseAgentFooter({ blocks: [agentContextBlock(footer)] })).toEqual({
      agentId: "agent-8acde0e1a059835a",
    });
  });

  it("recovers the author from a footer carrying a session", () => {
    const block = agentContextBlock({ ...footer, sessionId: "sess-42" });
    expect(parseAgentFooter({ blocks: [block] })).toEqual({
      agentId: "agent-8acde0e1a059835a",
    });
  });

  /**
   * TEST_SCENARIO: Every post already made in every channel carries an older URL
   * form, and injected history reaches back through all of them. A legacy footer
   * that stops parsing is silent — the line just reattributes to a bare Slack id
   * — so each retired form keeps its own case.
   */
  it.each([
    ["chat", "http://ui/chat/agent-8acde0e1a059835a"],
    [
      "chat with a session path",
      "http://ui/chat/agent-8acde0e1a059835a/sess-42",
    ],
    ["sandboxes", "http://ui/sandboxes/agent-8acde0e1a059835a"],
    [
      "sandboxes with a session path",
      "http://ui/sandboxes/agent-8acde0e1a059835a/sess-42",
    ],
  ])("recovers the author from the legacy %s form", (_form, url) => {
    expect(parseAgentFooter(contextText(`<${url}|Helper>`))).toEqual({
      agentId: "agent-8acde0e1a059835a",
    });
  });

  /**
   * TEST_SCENARIO: Attribution used to read the link label as the agent's name.
   * With one fixed label for every agent that would make every post parse to the
   * same name, so the parse must expose the id and nothing else.
   */
  it("reports only the id, whatever the label says", () => {
    const parsed = parseAgentFooter({
      blocks: [agentContextBlock({ ...footer, label: "Ops" })],
    });
    expect(parsed).toEqual({ agentId: "agent-8acde0e1a059835a" });
  });

  it("returns null for a message with no agent footer", () => {
    expect(parseAgentFooter({ text: "hi", user: "U1" })).toBeNull();
    expect(
      parseAgentFooter({ blocks: [{ type: "section", text: "x" }] }),
    ).toBeNull();
  });
});

describe("labelHistoryMessage", () => {
  const human: SlackMessage = { text: "hey", user: "U123" };
  const mine: SlackMessage = { text: "on it" };
  const theirs: SlackMessage = { text: "already handled" };

  it("labels the reading agent's own posts", () => {
    expect(
      labelHistoryMessage(
        mine,
        { agentId: footer.agentId, name: "Helper" },
        footer.agentId,
        NO_BOT,
      ),
    ).toBe("you (this agent): on it");
  });

  it("names another agent's posts from its resolved display name", () => {
    expect(
      labelHistoryMessage(
        theirs,
        { agentId: "agent-other", name: "Ops" },
        footer.agentId,
        NO_BOT,
      ),
    ).toBe("Ops (another agent): already handled");
  });

  /**
   * TEST_SCENARIO: A deleted agent resolves to no name. The line still has to
   * say which agent wrote it, so it falls back to the raw agent id.
   */
  it("falls back to the agent id when no name resolved", () => {
    expect(
      labelHistoryMessage(
        theirs,
        { agentId: "agent-other", name: "" },
        footer.agentId,
        NO_BOT,
      ),
    ).toBe("agent-other (another agent): already handled");
  });

  it("keeps humans as their Slack id", () => {
    expect(labelHistoryMessage(human, null, footer.agentId, NO_BOT)).toBe(
      "U123: hey",
    );
  });

  it("includes a human-readable timestamp when the message carries one", () => {
    const withTs: SlackMessage = { ts: "0.1", text: "hey", user: "U123" };
    expect(labelHistoryMessage(withTs, null, footer.agentId, NO_BOT)).toBe(
      `U123 [${formatSlackTs("0.1")}]: hey`,
    );
  });

  it("marks a message Slack reports as edited", () => {
    const edited: SlackMessage = {
      ts: "0.1",
      text: "hey",
      user: "U123",
      edited: true,
    };
    expect(labelHistoryMessage(edited, null, footer.agentId, NO_BOT)).toBe(
      `U123 [${formatSlackTs("0.1")}]: hey (edited)`,
    );
  });
});

describe("formatSlackTs", () => {
  it("renders a Slack ts as a human-readable UTC string", () => {
    expect(formatSlackTs("1774620000.123456")).toBe("Fri 2026-03-27 14:00 UTC");
  });

  it("falls back to the raw string on unparseable input", () => {
    expect(formatSlackTs("not-a-timestamp")).toBe("not-a-timestamp");
  });
});

describe("renderAssistantBlocks", () => {
  it("appends the link footer after the text", () => {
    expect(renderAssistantBlocks(footer, "hello")).toEqual([
      { type: "markdown", text: "hello" },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "<http://ui/a/agent-8acde0e1a059835a|Powered by DAM>",
          },
        ],
      },
    ]);
  });
});
