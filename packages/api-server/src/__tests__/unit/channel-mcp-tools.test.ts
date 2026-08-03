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
} from "../../modules/channels/services/channel-manager.js";

// The security log is the audit trail for agent egress; capture it rather than
// letting it write to stdout, so a test can assert what a post recorded.
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

/** Drive the per-Agent MCP endpoint the way a harness does — over a real MCP
 *  client, so the tool's declared input schema is what gets exercised. This is
 *  the layer the outbound tools live at; `channelManager` is stubbed to record
 *  what the tool asked the channel for. */
async function mcpHarness(opts?: {
  supportsMessageReactions?: boolean;
  reactions?: MessageReactionsResult | { error: string };
}) {
  const replies: ChannelReply[] = [];
  const reactionQueries: ReactionsQuery[] = [];
  const channelManager = {
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
  };

  const session = createMcpSession("agent-1", {
    channelManager,
    k8s: { namespace: "platform" },
    maxArtifactBytes: 10 * 1024 * 1024,
    agentHome: "/home/agent",
    supportsMessageReactions: opts?.supportsMessageReactions ?? true,
  } as unknown as McpSessionDeps);

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await session.server.connect(serverTransport);
  const client = new Client({ name: "test-harness", version: "1.0.0" });
  await client.connect(clientTransport);

  return { client, replies, reactionQueries, channelManager };
}

describe("reply MCP tool — broadcast to channel (#2973)", () => {
  beforeEach(() => {
    auditLines.length = 0;
  });

  it("advertises the broadcast option on its input schema, so an agent can find it", async () => {
    const { client } = await mcpHarness();
    const { tools } = await client.listTools();
    const reply = tools.find((t) => t.name === "reply");

    const properties = reply?.inputSchema.properties as
      | Record<string, { type?: string }>
      | undefined;
    expect(properties?.alsoSendToChannel).toMatchObject({ type: "boolean" });
    // Off unless asked: nothing about it may be required.
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

  it("is registered when the channel manager reports scope support", async () => {
    const { client } = await mcpHarness({ supportsMessageReactions: true });
    const { tools } = await client.listTools();

    expect(tools.some((t) => t.name === "describe_message_reactions")).toBe(
      true,
    );
  });

  it("is omitted entirely when reactions:read is confirmed missing", async () => {
    const { client } = await mcpHarness({ supportsMessageReactions: false });
    const { tools } = await client.listTools();

    expect(tools.some((t) => t.name === "describe_message_reactions")).toBe(
      false,
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
    // The tool's whole point is defaulting to the bound channel and the
    // current turn's message — the audit trail and the agent-facing result
    // must still name what was actually inspected, not an empty request.
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
