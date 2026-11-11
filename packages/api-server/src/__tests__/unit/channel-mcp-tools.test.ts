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
  ChannelHistoryQuery,
  ChannelReply,
  ChannelSendResult,
  MessageReactionsResult,
  PostEdit,
  ReactionsQuery,
  ThreadQuery,
  ThreadResult,
} from "../../modules/channels/services/channel-manager.js";

vi.mock("../../core/agent-service-client.js", () => ({
  agentServiceClient: () => ({
    sessions: { byRef: { query: async () => ({ sessionId: "s-web" }) } },
  }),
}));

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
  postResult?: ChannelSendResult;
  replyResult?: ChannelSendResult;
  editResult?: ChannelSendResult;
  reactions?: MessageReactionsResult | { error: string };
  thread?: ThreadResult | { error: string };
  attachment?: AttachmentResult | { error: string };
  artifacts?: Record<string, { title: string; shareUrl: string | null }>;
  readsChannelHistory?: boolean;
  sessionRef?: string;
}) {
  const replies: ChannelReply[] = [];
  const edits: { type: ChannelType; edit: PostEdit }[] = [];
  const posts: { text: string; options: Record<string, unknown> }[] = [];
  const reactionQueries: ReactionsQuery[] = [];
  const threadQueries: ThreadQuery[] = [];
  const historyQueries: ChannelHistoryQuery[] = [];
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
        return opts?.postResult ?? ({ ok: true } as ChannelSendResult);
      },
    ),
    reply: vi.fn(
      async (_agentId: string, _type: ChannelType, args: ChannelReply) => {
        replies.push(args);
        return opts?.replyResult ?? ({ ok: true } as ChannelSendResult);
      },
    ),
    editPost: vi.fn(
      async (_agentId: string, type: ChannelType, edit: PostEdit) => {
        edits.push({ type, edit });
        return opts?.editResult ?? ({ ok: true } as ChannelSendResult);
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
    readChannelHistory: vi.fn(
      async (
        _agentId: string,
        _type: ChannelType,
        query: ChannelHistoryQuery,
      ) => {
        historyQueries.push(query);
        return {
          messages: [
            "U999 [Wed 2026-09-17 09:12 UTC, ts 1758100320.000000]: the plan",
          ],
          conversationId: "C-BOUND",
          hasMore: false,
        };
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
    uiBaseUrl: "http://ui",
    ...(opts?.sessionRef ? { sessionRef: opts.sessionRef } : {}),
    channelManager,
    k8s: { namespace: "platform" },
    maxArtifactBytes: 10 * 1024 * 1024,
    artifactLibrary: {
      get: async (id: string) => opts?.artifacts?.[id] ?? null,
    },
    readsChannelHistory: opts?.readsChannelHistory ?? false,
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
    edits,
    reactionQueries,
    threadQueries,
    historyQueries,
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
        options: { byAgent: true, unfurlLinks: false, unfurlMedia: false },
      },
    ]);
    expect(replies).toEqual([
      { text: "media without cards", threadTs: "1.1", unfurlMedia: false },
      { text: "Slack default previews", threadTs: "1.2" },
    ]);
  });
});

describe("edit_post MCP tool — an agent changes its own post (#6406)", () => {
  // TEST_SCENARIO: the agent passes the reference a posting tool returned and the whole new text; the tool hands both on for the messenger it names and records the edit, with no message-sent event, since nothing new was posted.
  it("hands the post's reference and the whole new text to the channel", async () => {
    const { client, edits } = await mcpHarness();
    auditLines.length = 0;
    const sent: ChannelMessageSent[] = [];
    const sub = events$()
      .pipe(ofType<ChannelMessageSent>(EventType.ChannelMessageSent))
      .subscribe((event) => sent.push(event));

    const result = await client.callTool({
      name: "edit_post",
      arguments: {
        channel: "slack",
        chatId: "C-BOUND",
        ts: "1758100320.000100",
        text: "step 2 of 3",
      },
    });
    sub.unsubscribe();

    expect(result.isError).toBeFalsy();
    expect(edits).toEqual([
      {
        type: ChannelType.Slack,
        edit: {
          conversationId: "C-BOUND",
          messageId: "1758100320.000100",
          text: "step 2 of 3",
        },
      },
    ]);
    expect(auditLines).toContainEqual({
      event: "channel.outbound",
      detail: expect.objectContaining({ action: "edit", hasCard: false }),
    });
    expect(sent).toEqual([]);
  });

  // TEST_SCENARIO: a refusal from the channel, such as another agent's post or edits that come too fast, reaches the agent as the tool's error, in the channel's own words.
  it("returns the channel's refusal as the tool error", async () => {
    const { client } = await mcpHarness({
      editResult: {
        error:
          "Another agent wrote that post. You can change only your own posts.",
      },
    });

    const result = await client.callTool({
      name: "edit_post",
      arguments: {
        channel: "slack",
        chatId: "C-BOUND",
        ts: "1.1",
        text: "rewritten",
      },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain(
      "You can change only your own posts",
    );
  });

  // TEST_SCENARIO: a card that fails its check must leave the post as it was, so the edit never reaches the channel.
  it("refuses a card that fails its check before anything changes", async () => {
    const { client, edits } = await mcpHarness();

    const result = await client.callTool({
      name: "edit_post",
      arguments: {
        channel: "slack",
        chatId: "C-BOUND",
        ts: "1.1",
        text: "status",
        card: { type: "NoSuchComponent", props: {} },
      },
    });

    expect(result.isError).toBe(true);
    expect(edits).toEqual([]);
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

describe("read_channel_history MCP tool", () => {
  beforeEach(() => {
    auditLines.length = 0;
  });

  /**
   * TEST_SCENARIO: Channel history is an opt-in on a binding, so an agent
   * that has it on nowhere must not be offered a tool that only refuses.
   */
  it("is listed only while channel history is on for one of the agent's conversations", async () => {
    const off = await mcpHarness();
    expect(
      (await off.client.listTools()).tools.some(
        (t) => t.name === "read_channel_history",
      ),
    ).toBe(false);

    const on = await mcpHarness({ readsChannelHistory: true });
    expect(
      (await on.client.listTools()).tools.some(
        (t) => t.name === "read_channel_history",
      ),
    ).toBe(true);
  });

  /**
   * TEST_SCENARIO: An agent asked about "last week" names times, not Slack
   * timestamps, so the tool takes ISO dates and hands the worker the Slack
   * times it pages by. The read returns message bodies, so it is logged.
   */
  it("turns since and until into Slack times, passes the query through, and logs what it read", async () => {
    const h = await mcpHarness({ readsChannelHistory: true });

    const result = await h.client.callTool({
      name: "read_channel_history",
      arguments: {
        chatId: "C-BOUND",
        since: "2026-11-02T00:00:00Z",
        until: "2026-11-09",
      },
    });

    expect(h.historyQueries).toEqual([
      {
        conversationId: "C-BOUND",
        since: "1793577600.000000",
        until: "1794182400.000000",
      },
    ]);
    expect(
      JSON.parse((result.content as { text: string }[])[0]!.text),
    ).toMatchObject({ conversationId: "C-BOUND", hasMore: false });
    expect(auditLines).toEqual([
      {
        event: "channel.history_read",
        detail: {
          conversationId: "C-BOUND",
          since: "2026-11-02T00:00:00Z",
          until: "2026-11-09",
          messages: 1,
          hasMore: false,
        },
      },
    ]);
  });

  it("refuses a time that is not an ISO 8601 date, or a range that ends before it starts, without reading anything", async () => {
    const h = await mcpHarness({ readsChannelHistory: true });

    for (const args of [
      { since: "last tuesday" },
      { since: "1" },
      { since: "March 5" },
      { since: "1969-12-31" },
      { since: "2026-02-31" },
      { since: "2026-11-02T09:00:00" },
      { since: "2026-11-09", until: "2026-11-01" },
    ]) {
      const result = await h.client.callTool({
        name: "read_channel_history",
        arguments: args,
      });
      expect(result.isError).toBe(true);
    }
    expect(h.historyQueries).toEqual([]);
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

describe("outbound MCP tools — channel cards", () => {
  const actions = (button: Record<string, unknown>) => ({
    type: "Card",
    props: { title: "Deploys" },
    children: [{ type: "Actions", props: {}, children: [button] }],
  });

  it("describes the card components on request, naming the tools that take a card", async () => {
    const { client } = await mcpHarness();
    const { tools } = await client.listTools();
    const describeTool = tools.find(
      (t) => t.name === "describe_card_components",
    );
    expect(describeTool?.description).toMatch(/reply, post and start_thread/);
    for (const name of ["reply", "post"])
      expect(
        tools.find((t) => t.name === name)?.inputSchema.properties,
      ).toHaveProperty("card");

    const res = (await client.callTool({
      name: "describe_card_components",
      arguments: {},
    })) as { content: { text: string }[] };
    const described = JSON.parse(res.content[0]!.text) as {
      components: { name: string }[];
    };
    const names = described.components.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "Card",
        "Fields",
        "Table",
        "Chart",
        "LinkButton",
      ]),
    );
    expect(names).not.toContain("Button");
  });

  it("passes the card the platform built to the channel", async () => {
    const { client, posts } = await mcpHarness();

    await client.callTool({
      name: "post",
      arguments: {
        channel: "slack",
        text: "This week",
        card: actions({
          type: "LinkButton",
          props: { label: "Open", url: "https://example.com" },
        }),
      },
    });

    expect(posts[0]?.options.card).toMatchObject({
      card: { type: "card", title: "Deploys" },
      text: expect.stringContaining("Deploys"),
    });
  });

  // TEST_SCENARIO: a refused card must not leave half an answer in the channel, and the agent must learn why.
  it("refuses a card that fails its check and posts nothing", async () => {
    const { client, replies } = await mcpHarness();

    const res = (await client.callTool({
      name: "reply",
      arguments: {
        text: "Approve?",
        card: actions({
          type: "Button",
          props: { id: "approve", label: "Approve" },
        }),
      },
    })) as { content: { text: string }[]; isError?: boolean };

    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain("describe_card_components");
    expect(replies).toEqual([]);
  });
});

describe("outbound MCP tools — post and its old name", () => {
  // TEST_SCENARIO: post is send_channel_message renamed; the old name stays for one release, does the same, and says it is deprecated.
  it("posts through both names, and marks the old one deprecated", async () => {
    const { client, posts } = await mcpHarness();
    const { tools } = await client.listTools();

    expect(tools.find((t) => t.name === "post")?.description).toContain(
      "start_thread",
    );
    expect(
      tools.find((t) => t.name === "send_channel_message")?.description,
    ).toMatch(/^Deprecated: .*call post instead/);

    await client.callTool({
      name: "post",
      arguments: { channel: "slack", text: "new name" },
    });
    await client.callTool({
      name: "send_channel_message",
      arguments: { channel: "slack", text: "old name" },
    });

    expect(posts.map((p) => p.text)).toEqual(["new name", "old name"]);
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

describe("outbound MCP tools — the posted message", () => {
  /**
   * TEST_SCENARIO: An agent that starts a thread with a top-level post needs the post's ts to reply into that thread later.
   */
  it("names the conversation and ts of a Slack post", async () => {
    const { client } = await mcpHarness({
      postResult: {
        ok: true,
        conversationId: "D-UOWNER",
        ts: "1712345.000100",
      },
    });

    const result = await client.callTool({
      name: "send_channel_message",
      arguments: { channel: "slack", text: "kick-off", chatId: "UOWNER" },
    });

    expect((result.content as { text: string }[])[0]!.text).toBe(
      "Message sent to chatId D-UOWNER as ts 1712345.000100. Replies under it are not followed and do not come back to this session; to get an answer here, ask with start_thread.",
    );
  });

  it("names the conversation and ts of a Slack reply", async () => {
    const { client } = await mcpHarness({
      replyResult: { ok: true, conversationId: "C1", ts: "1712345.000200" },
    });

    const result = await client.callTool({
      name: "reply",
      arguments: { text: "answer", threadTs: "1.1" },
    });

    expect((result.content as { text: string }[])[0]!.text).toBe(
      "Reply posted to chatId C1 as ts 1712345.000200",
    );
  });

  it("says only that it was sent when the channel names no ts", async () => {
    const { client } = await mcpHarness({
      postResult: { ok: true, conversationId: "C-ALERTS" },
    });

    const result = await client.callTool({
      name: "send_channel_message",
      arguments: { channel: "slack", text: "report", chatId: "C-ALERTS" },
    });

    expect((result.content as { text: string }[])[0]!.text).toMatch(
      /^Message sent\. Replies under it are not followed/,
    );
  });
});

describe("outbound MCP tools — artifact links (#5965)", () => {
  const PUBLIC_ID = "0b6f6a52-5d0e-4a4e-9b1e-1f0c2a3b4c5d";
  const PRIVATE_ID = "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

  /**
   * TEST_SCENARIO: The reported bug was an in-app artifact link reaching Slack
   * as dead text. The channel worker that sends the message owns that decision,
   * against the one destination it resolved, so the tools hand it the text and
   * the card exactly as the agent wrote them, app links included, and the card
   * is checked in the form it was written.
   */
  it("hands the text and the card to the channel, app links untouched", async () => {
    const { client, replies, posts } = await mcpHarness();

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
    await client.callTool({
      name: "post",
      arguments: {
        channel: ChannelType.Slack,
        text: "Draft",
        card: {
          type: "Card",
          props: { title: "Draft" },
          children: [
            {
              type: "Actions",
              props: {},
              children: [
                {
                  type: "LinkButton",
                  props: {
                    label: "Open",
                    url: `platform://artifacts/${PRIVATE_ID}`,
                  },
                },
              ],
            },
          ],
        },
      },
    });

    expect(replies[0]?.text).toBe(
      `See [Weekly report](platform://artifacts/${PUBLIC_ID})`,
    );
    expect(posts.map((p) => p.text)).toEqual([
      `Report: platform://artifacts/${PUBLIC_ID}`,
      "Draft",
    ]);
    expect(JSON.stringify(posts[1]?.options.card)).toContain(
      `platform://artifacts/${PRIVATE_ID}`,
    );
  });
});
