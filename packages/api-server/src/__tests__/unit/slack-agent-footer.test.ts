import { describe, it, expect } from "vitest";
import {
  agentContextBlock,
  agentFooterMrkdwn,
  formatSlackTs,
  labelHistoryMessage,
  parseAgentFooter,
  type AgentFooter,
} from "../../modules/channels/infrastructure/agent-footer.js";
import { renderAssistantBlocks } from "../../modules/channels/infrastructure/slack-turn-presenter.js";
import type { SlackMessage } from "../../modules/channels/infrastructure/slack-gateway.js";

const footer: AgentFooter = {
  uiBaseUrl: "http://ui",
  agentId: "agent-8acde0e1a059835a",
  agentName: "Helper",
};

describe("agent footer", () => {
  it("renders the name as a link with the id in the URL", () => {
    expect(agentFooterMrkdwn(footer)).toBe(
      "<http://ui/chat/agent-8acde0e1a059835a|Helper>",
    );
  });

  it("links at the session when the post belongs to a turn", () => {
    expect(agentFooterMrkdwn({ ...footer, sessionId: "sess-42" })).toBe(
      "<http://ui/chat/agent-8acde0e1a059835a/sess-42|Helper>",
    );
  });

  it("falls back to the id as link text when the name is empty", () => {
    expect(agentFooterMrkdwn({ ...footer, agentName: "" })).toBe(
      "<http://ui/chat/agent-8acde0e1a059835a|agent-8acde0e1a059835a>",
    );
  });

  it("sanitizes a name that would break the <url|label> syntax", () => {
    const mrkdwn = agentFooterMrkdwn({
      ...footer,
      agentName: "a|b <c> & d\nnext",
    });
    expect(mrkdwn).toBe(
      "<http://ui/chat/agent-8acde0e1a059835a|a b &lt;c&gt; &amp; d next>",
    );
    expect(agentFooterMrkdwn({ ...footer, agentName: "R&D" })).toContain(
      "|R&amp;D>",
    );
  });

  it("round-trips through the context block", () => {
    const block = agentContextBlock(footer);
    expect(parseAgentFooter({ blocks: [block] })).toEqual({
      agentId: "agent-8acde0e1a059835a",
      agentName: "Helper",
    });
  });

  it("recovers the author from a session link", () => {
    const block = agentContextBlock({ ...footer, sessionId: "sess-42" });
    expect(parseAgentFooter({ blocks: [block] })).toEqual({
      agentId: "agent-8acde0e1a059835a",
      agentName: "Helper",
    });
  });

  it("recovers the author from a footer minted before session links", () => {
    expect(
      parseAgentFooter({
        blocks: [
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: "<http://ui/sandboxes/agent-8acde0e1a059835a|Helper>",
              },
            ],
          },
        ],
      }),
    ).toEqual({ agentId: "agent-8acde0e1a059835a", agentName: "Helper" });
  });

  it("recovers a sanitized name on parse", () => {
    const block = agentContextBlock({ ...footer, agentName: "R&D <team>" });
    expect(parseAgentFooter({ blocks: [block] })?.agentName).toBe("R&D <team>");
  });

  it("returns null for a message with no agent footer", () => {
    expect(parseAgentFooter({ text: "hi", user: "U1" })).toBeNull();
    expect(
      parseAgentFooter({ blocks: [{ type: "section", text: "x" }] }),
    ).toBeNull();
  });
});

describe("labelHistoryMessage", () => {
  const mine: SlackMessage = {
    text: "on it",
    blocks: [agentContextBlock(footer)],
  };
  const theirs: SlackMessage = {
    text: "already handled",
    blocks: [
      agentContextBlock({
        ...footer,
        agentId: "agent-other",
        agentName: "Ops",
      }),
    ],
  };
  const human: SlackMessage = { text: "hey", user: "U123" };

  it("labels the reading agent's own posts", () => {
    expect(
      labelHistoryMessage(mine, parseAgentFooter(mine), footer.agentId),
    ).toBe("you (this agent): on it");
  });

  it("names another agent's posts", () => {
    expect(
      labelHistoryMessage(theirs, parseAgentFooter(theirs), footer.agentId),
    ).toBe("Ops (another agent): already handled");
  });

  it("keeps humans as their Slack id", () => {
    expect(labelHistoryMessage(human, null, footer.agentId)).toBe("U123: hey");
  });

  it("includes a human-readable timestamp when the message carries one", () => {
    const withTs: SlackMessage = { ts: "0.1", text: "hey", user: "U123" };
    expect(labelHistoryMessage(withTs, null, footer.agentId)).toBe(
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
    expect(labelHistoryMessage(edited, null, footer.agentId)).toBe(
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
            text: "<http://ui/chat/agent-8acde0e1a059835a|Helper>",
          },
        ],
      },
    ]);
  });
});
