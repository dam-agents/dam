import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ChannelType } from "api-server-api";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMcpSession,
  type McpSessionDeps,
} from "../../apps/harness-api-server/mcp-endpoint.js";
import type {
  ChannelReply,
  MessageReactionsResult,
  ReactionsQuery,
  ThreadQuery,
  ThreadResult,
} from "../../modules/channels/services/channel-manager.js";

const { auditLines } = vi.hoisted(() => ({
  auditLines: [] as { event: string; detail: Record<string, unknown> }[],
}));
vi.mock("../../core/security-log.js", () => ({
  securityLog: (
    _level: string,
    event: string,
    fields: { detail?: Record<string, unknown> },
  ) => {
    auditLines.push({ event, detail: fields.detail ?? {} });
  },
}));

async function mcpHarness(opts?: {
  reactions?: MessageReactionsResult | { error: string };
  thread?: ThreadResult | { error: string };
}) {
  const replies: ChannelReply[] = [];
  const posts: { text: string; options: Record<string, unknown> }[] = [];
  const reactionQueries: ReactionsQuery[] = [];
  const threadQueries: ThreadQuery[] = [];
  const channelManager = {
    postMessage: vi.fn(
      async (
        _agentId: string,
        _type: ChannelType,
        text: string,
        options: Record<string, unknown>,
      ) => {
        posts.push({ text, options });
        return { ok: true as const };
      },
    ),
    reply: vi.fn(
      async (_agentId: string, _type: ChannelType, args: ChannelReply) => {
        replies.push(args);
        return { ok: true as const };
      },
    ),
    describeMessageReactions: vi.fn(
      async (_agentId: string, _type: ChannelType, query: ReactionsQuery) => {
        reactionQueries.push(query);
        return (
          opts?.reactions ?? {
            reactions: [],
            conversationId: "C-BOUND",
            messageTs: "1.1",
          }
        );
      },
    ),
    readThread: vi.fn(
      async (_agentId: string, _type: ChannelType, query: ThreadQuery) => {
        threadQueries.push(query);
        return (
          opts?.thread ?? {
            messages: ["U999 [Wed 2026-09-17 09:12 UTC]: the question"],
            conversationId: "C-BOUND",
            threadTs: query.threadTs,
            hasMore: false,
          }
        );
      },
    ),
  };

  const session = createMcpSession("agent-1", {
    channelManager,
    k8s: { namespace: "platform" },
    maxArtifactBytes: 10 * 1024 * 1024,
  } as unknown as McpSessionDeps);

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await session.server.connect(serverTransport);
  const client = new Client({ name: "test-harness", version: "1.0.0" });
  await client.connect(clientTransport);

  return {
    client,
    posts,
    replies,
    reactionQueries,
    threadQueries,
    channelManager,
  };
}

describe("outbound MCP tools — Slack unfurls (#3499)", () => {
  it("advertises optional unfurl controls for new messages and replies", async () => {
    const { client } = await mcpHarness();
    const { tools } = await client.listTools();

    for (const name of ["send_channel_message", "reply"]) {
      const tool = tools.find((candidate) => candidate.name === name);
      const properties = tool?.inputSchema.properties as
        Record<string, { type?: string }> | undefined;
      expect(properties?.unfurlLinks).toMatchObject({ type: "boolean" });
      expect(properties?.unfurlMedia).toMatchObject({ type: "boolean" });
      expect(tool?.inputSchema.required ?? []).not.toContain("unfurlLinks");
      expect(tool?.inputSchema.required ?? []).not.toContain("unfurlMedia");
    }
  });

  it("passes explicit unfurl controls through without changing omitted defaults", async () => {
    const { client, posts, replies } = await mcpHarness();

    await client.callTool({
      name: "send_channel_message",
      arguments: {
        channel: "slack",
        text: "links without cards",
        unfurlLinks: false,
        unfurlMedia: false,
      },
    });
    await client.callTool({
      name: "reply",
      arguments: {
        text: "media without cards",
        threadTs: "1.1",
        unfurlMedia: false,
      },
    });
    await client.callTool({
      name: "reply",
      arguments: { text: "Slack default previews", threadTs: "1.2" },
    });

    expect(posts).toEqual([
      {
        text: "links without cards",
        options: { unfurlLinks: false, unfurlMedia: false },
      },
    ]);
    expect(replies).toEqual([
      { text: "media without cards", threadTs: "1.1", unfurlMedia: false },
      { text: "Slack default previews", threadTs: "1.2" },
    ]);
  });
});

describe("reply MCP tool — broadcast to channel (#2973)", () => {
  beforeEach(() => {
    auditLines.length = 0;
  });

  it("advertises the broadcast option on its input schema, so an agent can find it", async () => {
    const { client } = await mcpHarness();
    const { tools } = await client.listTools();
    const reply = tools.find((t) => t.name === "reply");

    const properties = reply?.inputSchema.properties as
      Record<string, { type?: string }> | undefined;
    expect(properties?.alsoSendToChannel).toMatchObject({ type: "boolean" });
    expect(reply?.inputSchema.required ?? []).not.toContain(
      "alsoSendToChannel",
    );
  });

  it("passes the broadcast request through to the channel", async () => {
    const { client, replies } = await mcpHarness();

    const res = await client.callTool({
      name: "reply",
      arguments: {
        text: "speaking order",
        threadTs: "1.1",
        alsoSendToChannel: true,
      },
    });

    expect(res.isError).toBeFalsy();
    expect(replies).toEqual([
      { text: "speaking order", threadTs: "1.1", alsoSendToChannel: true },
    ]);
  });

  it("leaves the reply thread-only when the option is omitted", async () => {
    const { client, replies } = await mcpHarness();

    await client.callTool({
      name: "reply",
      arguments: { text: "ordinary answer", threadTs: "1.1" },
    });

    expect(replies).toHaveLength(1);
    expect(replies[0]).not.toHaveProperty("alsoSendToChannel");
  });

  it("records a broadcast in the audit trail, and an ordinary reply without it", async () => {
    const { client } = await mcpHarness();

    await client.callTool({
      name: "reply",
      arguments: { text: "loud", threadTs: "1.1", alsoSendToChannel: true },
    });
    await client.callTool({
      name: "reply",
      arguments: { text: "quiet", threadTs: "1.1" },
    });

    const outbound = auditLines.filter((l) => l.event === "channel.outbound");
    expect(outbound).toHaveLength(2);
    expect(outbound[0].detail).toMatchObject({
      action: "reply",
      alsoSendToChannel: true,
    });
    expect(outbound[1].detail).not.toHaveProperty("alsoSendToChannel");
  });
});

describe("describe_message_reactions MCP tool", () => {
  beforeEach(() => {
    auditLines.length = 0;
  });

  /**
   * TEST_SCENARIO: The tool list is per Agent while a Slack scope is granted
   * per workspace, so the list cannot answer for all of them. The tool is
   * always offered and reports a withheld scope when the call is made, rather
   * than vanishing for every workspace because one of them said no.
   */
  it("stays offered whatever a single workspace granted", async () => {
    const { client } = await mcpHarness();
    const { tools } = await client.listTools();

    expect(tools.some((t) => t.name === "describe_message_reactions")).toBe(
      true,
    );
  });

  it("passes chatId and messageTs through to the channel manager, and returns the resolved target", async () => {
    const { client, reactionQueries } = await mcpHarness({
      reactions: {
        reactions: [{ name: "eyes", count: 1, users: ["U1"] }],
        conversationId: "C-GENERAL",
        messageTs: "1.1",
      },
    });

    const res = await client.callTool({
      name: "describe_message_reactions",
      arguments: { channel: "slack", chatId: "C-GENERAL", messageTs: "1.1" },
    });

    expect(res.isError).toBeFalsy();
    expect(reactionQueries).toEqual([
      { conversationId: "C-GENERAL", messageTs: "1.1" },
    ]);
    expect(JSON.parse((res.content as [{ text: string }])[0].text)).toEqual({
      reactions: [{ name: "eyes", count: 1, users: ["U1"] }],
      conversationId: "C-GENERAL",
      messageTs: "1.1",
    });
  });

  it("audits the resolved message and the reaction tally, never the reacting users", async () => {
    const { client } = await mcpHarness({
      reactions: {
        reactions: [{ name: "eyes", count: 2, users: ["U1", "U2"] }],
        conversationId: "C-BOUND",
        messageTs: "1.1",
      },
    });

    await client.callTool({
      name: "describe_message_reactions",
      arguments: { channel: "slack", messageTs: "1.1" },
    });

    const lookups = auditLines.filter(
      (l) => l.event === "channel.reaction_lookup",
    );
    expect(lookups).toHaveLength(1);
    expect(lookups[0].detail).toEqual({
      conversationId: "C-BOUND",
      messageTs: "1.1",
      reactions: [{ name: "eyes", count: 2 }],
    });
    expect(JSON.stringify(lookups[0].detail)).not.toContain("U1");
  });

  it("audits and returns the resolved chat and message even when the call omits both (the common case)", async () => {
    const { client } = await mcpHarness({
      reactions: {
        reactions: [{ name: "thumbsup", count: 1, users: ["U9"] }],
        conversationId: "C-BOUND",
        messageTs: "1.1",
      },
    });

    const res = await client.callTool({
      name: "describe_message_reactions",
      arguments: { channel: "slack" },
    });

    expect(res.isError).toBeFalsy();
    expect(
      JSON.parse((res.content as [{ text: string }])[0].text),
    ).toMatchObject({
      conversationId: "C-BOUND",
      messageTs: "1.1",
    });
    const lookups = auditLines.filter(
      (l) => l.event === "channel.reaction_lookup",
    );
    expect(lookups[0].detail).toMatchObject({
      conversationId: "C-BOUND",
      messageTs: "1.1",
    });
  });

  it("returns an error result and audits the failure when the message can't be found", async () => {
    const { client } = await mcpHarness({
      reactions: { error: "message not found" },
    });

    const res = await client.callTool({
      name: "describe_message_reactions",
      arguments: { channel: "slack", messageTs: "9.9" },
    });

    expect(res.isError).toBe(true);
    const lookups = auditLines.filter(
      (l) => l.event === "channel.reaction_lookup",
    );
    expect(lookups).toHaveLength(1);
    expect(lookups[0].detail).toEqual({ messageTs: "9.9" });
  });
});

describe("read_thread MCP tool", () => {
  beforeEach(() => {
    auditLines.length = 0;
  });

  /**
   * TEST_SCENARIO: The tool as the agent meets it over MCP. It reads message
   * bodies the agent was not otherwise given, so an unlogged read is the one
   * an operator cannot reconstruct later.
   */
  it("advertises itself, passes the query through, and logs what it read", async () => {
    const h = await mcpHarness();

    const tools = (await h.client.listTools()).tools;
    expect(tools.some((t) => t.name === "read_thread")).toBe(true);

    const result = await h.client.callTool({
      name: "read_thread",
      arguments: {
        channel: ChannelType.Slack,
        threadTs: "1758100320.000000",
      },
    });

    expect(h.threadQueries).toEqual([{ threadTs: "1758100320.000000" }]);
    expect(JSON.parse((result.content as { text: string }[])[0]!.text)).toEqual(
      {
        messages: ["U999 [Wed 2026-09-17 09:12 UTC]: the question"],
        conversationId: "C-BOUND",
        threadTs: "1758100320.000000",
        hasMore: false,
      },
    );
    expect(auditLines).toEqual([
      {
        event: "channel.thread_read",
        detail: {
          conversationId: "C-BOUND",
          threadTs: "1758100320.000000",
          messages: 1,
          hasMore: false,
        },
      },
    ]);
  });

  /**
   * TEST_SCENARIO: A refused read still has to leave a trail — the offer
   * registry is what stops an agent reading a thread it was never shown.
   */
  it("surfaces a refusal to the agent and records the reason", async () => {
    const h = await mcpHarness({
      thread: { error: "not a thread you were shown" },
    });

    const result = await h.client.callTool({
      name: "read_thread",
      arguments: { channel: ChannelType.Slack, threadTs: "1.1" },
    });

    expect(result.isError).toBe(true);
    expect(auditLines).toEqual([
      { event: "channel.thread_read", detail: { threadTs: "1.1" } },
    ]);
  });
});
