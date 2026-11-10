// TEST_OVERVIEW: a Session starts a Slack thread, lists the threads it follows and leaves one, always as itself: the platform names the calling Session, never the agent, and a call it cannot attribute to a Session is refused rather than owning a thread nobody can be routed to.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ChannelType } from "api-server-api";
import { describe, expect, it } from "vitest";
import {
  registerThreadTools,
  type ThreadToolPorts,
} from "../../apps/harness-api-server/thread-tools.js";
import type { ChannelArtifactLinks } from "../../modules/artifact-library/channel-links.js";
import type {
  ThreadLeave,
  ThreadStart,
} from "../../modules/channels/services/channel-manager.js";

const artifactLinks = (): ChannelArtifactLinks => ({
  surface: "Slack",
  appArtifactUrl: (id) => `http://ui/artifacts/${id}`,
  lookup: async () => null,
  ownerDirectMessage: async () => false,
});

async function harness(over: Partial<ThreadToolPorts> = {}) {
  const starts: Array<{ channel: ChannelType; start: ThreadStart }> = [];
  const leaves: ThreadLeave[] = [];
  const audits: string[] = [];
  const server = new McpServer({ name: "test", version: "1.0.0" });
  registerThreadTools(server, {
    callerSessionId: async () => "s-web",
    linksFor: artifactLinks,
    cardOf: async () => ({}),
    startThread: async (channel, start) => {
      starts.push({ channel, start });
      return {
        ok: true,
        conversationId: start.conversationId,
        threadTs: "5.5",
      };
    },
    listThreads: async () => ({
      threads: [
        {
          conversationId: "C-OTHER",
          threadTs: "5.5",
          firstLine: "Which region?",
          startedAt: "2026-11-04T10:00:00.000Z",
          replies: 2,
          lastActivityAt: "2026-11-04T10:05:00.000Z",
          replyWaiting: false,
        },
      ],
    }),
    leaveThread: async (_channel, leave) => {
      leaves.push(leave);
      return { ok: true };
    },
    audit: (action, outcome) =>
      audits.push(`${action}:${"error" in outcome ? "failure" : "success"}`),
    ...over,
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "t", version: "1.0.0" });
  await client.connect(clientSide);
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = (await client.callTool({ name, arguments: args })) as {
      content: { text: string }[];
      isError?: boolean;
    };
    return { text: res.content[0]!.text, isError: res.isError === true };
  };
  return { call, starts, leaves, audits };
}

describe("start_thread", () => {
  it("starts the thread for the calling session and says the replies come back", async () => {
    const h = await harness();

    const res = await h.call("start_thread", {
      channel: "slack",
      chatId: "C-OTHER",
      text: "Which region?",
    });

    expect(res.isError).toBe(false);
    expect(h.starts).toEqual([
      {
        channel: ChannelType.Slack,
        start: {
          sessionId: "s-web",
          conversationId: "C-OTHER",
          text: "Which region?",
        },
      },
    ]);
    expect(JSON.parse(res.text)).toMatchObject({
      chatId: "C-OTHER",
      threadTs: "5.5",
      replies: expect.stringContaining("end your turn"),
    });
    expect(h.audits).toEqual(["start:success"]);
  });

  it("opens the thread with the card the platform built", async () => {
    const card = {
      card: { type: "card" as const, title: "Regions", children: [] },
      text: "**Regions**",
    };
    const checkedFor: ChannelArtifactLinks[] = [];
    const h = await harness({
      cardOf: async (_tree, links) => {
        checkedFor.push(links);
        return { card };
      },
    });

    await h.call("start_thread", {
      channel: "slack",
      chatId: "C-OTHER",
      text: "Which region?",
      card: { type: "Card", props: { title: "Regions" } },
    });

    expect(h.starts[0]?.start.card).toEqual(card);
    expect(checkedFor).toHaveLength(1);
  });

  // TEST_SCENARIO: a card the platform refuses must not leave a thread behind with only half of what the agent meant to ask.
  it("starts no thread when the card is refused", async () => {
    const h = await harness({
      cardOf: async () => ({
        error: "The card was not sent: root must be a Card.",
      }),
    });

    const res = await h.call("start_thread", {
      channel: "slack",
      chatId: "C-OTHER",
      text: "Which region?",
      card: { type: "Text", props: { content: "x" } },
    });

    expect(res.isError).toBe(true);
    expect(res.text).toContain("root must be a Card");
    expect(h.starts).toEqual([]);
    expect(h.audits).toEqual(["start:failure"]);
  });

  // TEST_SCENARIO: a call the platform cannot tie to a Session owns nothing, and points at post instead.
  it("refuses when the calling session is unknown", async () => {
    const h = await harness({ callerSessionId: async () => null });

    const res = await h.call("start_thread", {
      channel: "slack",
      chatId: "C-OTHER",
      text: "Which region?",
    });

    expect(res.isError).toBe(true);
    expect(res.text).toContain("post");
    expect(h.starts).toEqual([]);
  });

  it("passes a refusal from the messenger back", async () => {
    const h = await harness({
      startThread: async () => ({ error: "telegram has no threads" }),
    });

    const res = await h.call("start_thread", {
      channel: "telegram",
      chatId: "42",
      text: "hi",
    });

    expect(res).toEqual({ text: "telegram has no threads", isError: true });
    expect(h.audits).toEqual(["start:failure"]);
  });
});

describe("list_threads and leave_thread", () => {
  it("lists the calling session's threads by chatId", async () => {
    const h = await harness();

    const res = await h.call("list_threads", { channel: "slack" });

    expect(JSON.parse(res.text)).toEqual({
      threads: [
        {
          chatId: "C-OTHER",
          threadTs: "5.5",
          firstLine: "Which region?",
          startedAt: "2026-11-04T10:00:00.000Z",
          replies: 2,
          lastActivityAt: "2026-11-04T10:05:00.000Z",
          replyWaiting: false,
        },
      ],
    });
  });

  it("leaves a thread for the calling session", async () => {
    const h = await harness();

    const res = await h.call("leave_thread", {
      channel: "slack",
      chatId: "C-OTHER",
      threadTs: "5.5",
    });

    expect(res.isError).toBe(false);
    expect(h.leaves).toEqual([
      { sessionId: "s-web", conversationId: "C-OTHER", threadTs: "5.5" },
    ]);
    expect(h.audits).toEqual(["leave:success"]);
  });
});
