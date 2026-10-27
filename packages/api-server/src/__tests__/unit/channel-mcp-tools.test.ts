import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ChannelType } from "api-server-api";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMcpSession,
  type McpSessionDeps,
} from "../../apps/harness-api-server/mcp-endpoint.js";
import {
  events$,
  ofType,
  EventType,
  type ChannelMessageSent,
} from "../../events.js";
import type {
  AttachmentQuery,
  AttachmentResult,
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
  postResult?: { ok: true } | { error: string };
  reactions?: MessageReactionsResult | { error: string };
  thread?: ThreadResult | { error: string };
  attachment?: AttachmentResult | { error: string };
  artifacts?: Record<string, { title: string; shareUrl: string | null }>;
}) {
  const replies: ChannelReply[] = [];
  const posts: { text: string; options: Record<string, unknown> }[] = [];
  const reactionQueries: ReactionsQuery[] = [];
  const threadQueries: ThreadQuery[] = [];
  const attachmentQueries: AttachmentQuery[] = [];
  const channelManager = {
    postMessage: vi.fn(
      async (
        _agentId: string,
        _type: ChannelType,
        text: string,
        options: Record<string, unknown>,
      ) => {
        posts.push({ text, options });
        return opts?.postResult ?? { ok: true as const };
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
    fetchAttachment: vi.fn(
      async (_agentId: string, _type: ChannelType, query: AttachmentQuery) => {
        attachmentQueries.push(query);
        return (
          opts?.attachment ?? {
            path: "/home/agent/.uploads/C-BOUND/1a2b3c4d-table.png",
            name: "table.png",
            size: 2048,
            contentType: "image/png",
            conversationId: "C-BOUND",
          }
        );
      },
    ),
  };

  const session = createMcpSession("agent-1", {
    owner: "owner-1",
    channelManager,
    k8s: { namespace: "platform" },
    maxArtifactBytes: 10 * 1024 * 1024,
    artifactLibrary: {
      get: async (id: string) => opts?.artifacts?.[id] ?? null,
    },
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
    attachmentQueries,
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

describe("react MCP tool — a reaction or a reply (#5994)", () => {
  it("describes a reaction as standing in for a reply, not as an acknowledgement", async () => {
    const { client } = await mcpHarness();
    const { tools } = await client.listTools();
    const react = tools.find((t) => t.name === "react");

    expect(react?.description).toContain(
      "in place of a reply when the emoji says enough by itself",
    );
    expect(react?.description).toContain("A reaction or a reply, not both");
    expect(react?.description).not.toContain("acknowledgement");
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

  it("passes chatId through as the conversation, so a multi-conversation agent can say where the thread is (#3753)", async () => {
    const { client, replies } = await mcpHarness();

    const res = await client.callTool({
      name: "reply",
      arguments: { text: "late answer", threadTs: "1.1", chatId: "C-SECOND" },
    });

    expect(res.isError).toBeFalsy();
    expect(replies).toEqual([
      { text: "late answer", threadTs: "1.1", conversationId: "C-SECOND" },
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

describe("fetch_message_attachment MCP tool", () => {
  beforeEach(() => {
    auditLines.length = 0;
  });

  /**
   * TEST_SCENARIO: An agent asked about a screenshot posted earlier fetches it
   * by the fileId from the history tag. The tool hands back where the file was
   * written, and the fetch is logged, because it moves a person's file into the
   * agent's workspace.
   */
  it("advertises itself, passes the fileId through, and logs the fetch", async () => {
    const h = await mcpHarness();

    const tools = (await h.client.listTools()).tools;
    expect(tools.some((t) => t.name === "fetch_message_attachment")).toBe(true);

    const result = await h.client.callTool({
      name: "fetch_message_attachment",
      arguments: { channel: ChannelType.Slack, fileId: "F0TABLE" },
    });

    expect(h.attachmentQueries).toEqual([{ fileId: "F0TABLE" }]);
    expect(JSON.parse((result.content as { text: string }[])[0]!.text)).toEqual(
      {
        path: "/home/agent/.uploads/C-BOUND/1a2b3c4d-table.png",
        name: "table.png",
        size: 2048,
        contentType: "image/png",
        conversationId: "C-BOUND",
      },
    );
    expect(auditLines).toEqual([
      {
        event: "channel.attachment_fetch",
        detail: { conversationId: "C-BOUND", fileId: "F0TABLE", bytes: 2048 },
      },
    ]);
  });

  /**
   * TEST_SCENARIO: A file outside the agent's connected conversations is
   * refused. The refusal reaches the agent as a tool error and is logged with
   * the id it asked for.
   */
  it("surfaces a refusal to the agent and records the fileId", async () => {
    const h = await mcpHarness({
      attachment: {
        error: "not a file shared in a conversation connected to this agent",
      },
    });

    const result = await h.client.callTool({
      name: "fetch_message_attachment",
      arguments: { channel: ChannelType.Slack, fileId: "F0NOPE" },
    });

    expect(result.isError).toBe(true);
    expect(auditLines).toEqual([
      { event: "channel.attachment_fetch", detail: { fileId: "F0NOPE" } },
    ]);
  });
});

describe("outbound MCP tools — activity", () => {
  it("records each post and reply against the agent's owner", async () => {
    const { client } = await mcpHarness();
    const sent: ChannelMessageSent[] = [];
    const sub = events$()
      .pipe(ofType<ChannelMessageSent>(EventType.ChannelMessageSent))
      .subscribe((event) => sent.push(event));

    await client.callTool({
      name: "send_channel_message",
      arguments: { channel: "slack", text: "unprompted update" },
    });
    await client.callTool({
      name: "reply",
      arguments: { text: "answer", threadTs: "1.1" },
    });
    sub.unsubscribe();

    expect(sent).toEqual([
      {
        type: EventType.ChannelMessageSent,
        channel: ChannelType.Slack,
        agentId: "agent-1",
        ownerSub: "owner-1",
        action: "post",
        outcome: "success",
        hasAttachment: false,
      },
      {
        type: EventType.ChannelMessageSent,
        channel: ChannelType.Slack,
        agentId: "agent-1",
        ownerSub: "owner-1",
        action: "reply",
        outcome: "success",
        hasAttachment: false,
      },
    ]);
  });

  it("records a post the channel refused as a failure", async () => {
    const { client } = await mcpHarness({
      postResult: { error: "channel_not_found" },
    });
    const sent: ChannelMessageSent[] = [];
    const sub = events$()
      .pipe(ofType<ChannelMessageSent>(EventType.ChannelMessageSent))
      .subscribe((event) => sent.push(event));

    await client.callTool({
      name: "send_channel_message",
      arguments: { channel: "slack", text: "lost", chatId: "C-GONE" },
    });
    sub.unsubscribe();

    expect(sent).toMatchObject([{ action: "post", outcome: "failure" }]);
  });
});

describe("outbound MCP tools — artifact links (#5965)", () => {
  const PUBLIC_ID = "0b6f6a52-5d0e-4a4e-9b1e-1f0c2a3b4c5d";
  const PRIVATE_ID = "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
  const artifacts = {
    [PUBLIC_ID]: {
      title: "Weekly report",
      shareUrl: "https://share.example/a/weekly-report",
    },
    [PRIVATE_ID]: { title: "Draft plan", shareUrl: null },
  };

  /**
   * TEST_SCENARIO: The reported bug. An agent posts the in-app artifact link
   * to Slack, where it is dead text. A public artifact's link is posted as
   * its share URL, in a reply and in a new message alike.
   */
  it("posts a public artifact's share URL in place of its in-app link", async () => {
    const { client, replies, posts } = await mcpHarness({ artifacts });

    await client.callTool({
      name: "reply",
      arguments: {
        text: `See [Weekly report](platform://artifacts/${PUBLIC_ID})`,
      },
    });
    await client.callTool({
      name: "send_channel_message",
      arguments: {
        channel: ChannelType.Telegram,
        text: `Report: platform://artifacts/${PUBLIC_ID}`,
      },
    });

    expect(replies[0]?.text).toBe(
      "See [Weekly report](https://share.example/a/weekly-report)",
    );
    expect(posts[0]?.text).toBe(
      "Report: https://share.example/a/weekly-report",
    );
  });

  /**
   * TEST_SCENARIO: A private artifact has no link that opens outside the
   * app. The message is not posted, and the agent is told to say that the
   * artifact must be shared first and to send the message without the link.
   */
  it("refuses a message that links a private artifact", async () => {
    const { client, replies } = await mcpHarness({ artifacts });

    const res = await client.callTool({
      name: "reply",
      arguments: { text: `Draft: platform://artifacts/${PRIVATE_ID}` },
    });

    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain(
      "must be shared from the app",
    );
    expect(replies).toEqual([]);
  });

  /**
   * TEST_SCENARIO: A link names an id the owner has no artifact for, a
   * deleted one or a typo. The message is not posted with a dead link.
   */
  it("refuses a message that links an unknown artifact", async () => {
    const { client, posts } = await mcpHarness({ artifacts });

    const res = await client.callTool({
      name: "send_channel_message",
      arguments: {
        channel: ChannelType.Slack,
        text: "platform://artifacts/does-not-exist",
      },
    });

    expect(res.isError).toBe(true);
    expect(posts).toEqual([]);
  });

  it("posts a message without artifact links unchanged", async () => {
    const { client, replies } = await mcpHarness({ artifacts });

    await client.callTool({
      name: "reply",
      arguments: { text: "see https://example.com/report" },
    });

    expect(replies[0]?.text).toBe("see https://example.com/report");
  });
});
