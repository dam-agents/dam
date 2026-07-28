import { describe, it, expect } from "vitest";
import { ChannelType, type AgentsService } from "api-server-api";
import { createSlackWorker } from "../../modules/channels/infrastructure/slack.js";
import { createChannelManager } from "../../modules/channels/services/channel-manager.js";
import {
  createFakeSlackGateway,
  type FakeSlackChannel,
  type FakeSlackGateway,
} from "../../modules/channels/infrastructure/fake-slack-gateway.js";
import type { AcpClient } from "../../core/acp-client.js";
import { configureLogger } from "../../core/logger.js";
import type { StoredChannelConfig } from "../../modules/channels/stored-channel.js";

const OWNER = "kc|owner-1";
const BOUND = "C-BOUND";
configureLogger({ level: "error", write: () => {} });

const workspace: FakeSlackChannel[] = [
  { id: BOUND, name: "agent-home", botIsMember: true },
  { id: "C-GENERAL", name: "general", botIsMember: true },
  // A visible channel the bot is not in (public, not yet invited).
  { id: "C-STAFF", name: "staff", botIsMember: false },
];

function harness(opts: {
  /** null = agent has no Slack binding. */
  boundChannelId: string | null;
  channels?: FakeSlackChannel[];
  /** Make the gateway fail to start, so ensureGateway yields null. */
  gatewayDown?: boolean;
  /** Replace getMessageReactions, e.g. to make Slack throw. */
  getMessageReactions?: FakeSlackGateway["getMessageReactions"];
}) {
  const gw = createFakeSlackGateway();
  gw.setChannels(opts.channels ?? []);
  if (opts.getMessageReactions)
    gw.getMessageReactions = opts.getMessageReactions;
  if (opts.gatewayDown) {
    gw.start = async () => false;
  }
  const acp = {
    listSessions: async () => [],
    sendPrompt: async () => "x",
    triggerSession: () => Promise.reject(new Error("unused")),
  } as unknown as AcpClient;
  const agents = {
    ensureReady: async () => {},
    isAllowedUser: async () => false,
  } as unknown as AgentsService;

  const worker = createSlackWorker(
    () => acp,
    () => gw,
    () => agents,
    { resolve: async () => null } as never,
    { authUrl: "http://kc", clientId: "c" } as never,
    new Map(),
    async () => OWNER,
    {
      resolveSlackBinding: async () => null,
      resolveSlackChannelByInstance: async () => opts.boundChannelId,
    },
    async () => {},
    async () => {},
    { name: "DAM", short: "dam" },
    async () => true,
    "http://ui",
    () => acp,
    () => {},
  );

  return {
    gw,
    worker,
    async describeReactions(
      query: Parameters<typeof worker.describeMessageReactions>[1],
    ) {
      await worker.start("agent-1", {} as StoredChannelConfig);
      return worker.describeMessageReactions("agent-1", query);
    },
  };
}

describe("slack message reactions", () => {
  it("unbound agent: the binding gates reactions too", async () => {
    const h = harness({ boundChannelId: null, channels: workspace });

    expect(await h.describeReactions({ messageTs: "1.1" })).toEqual({
      error: "no channel connected",
    });
  });

  it("errors when the bot is not running", async () => {
    const h = harness({
      boundChannelId: BOUND,
      channels: workspace,
      gatewayDown: true,
    });

    expect(await h.describeReactions({ messageTs: "1.1" })).toEqual({
      error: "slack bot not running",
    });
  });

  it("resolves reactions for an explicit messageTs in the bound channel", async () => {
    const h = harness({ boundChannelId: BOUND, channels: workspace });
    h.gw.setMessageReactions(BOUND, "1.1", [
      { name: "eyes", count: 1, users: ["U1"] },
      { name: "thumbsup", count: 3, users: ["U1", "U2", "U3"] },
    ]);

    const result = await h.describeReactions({ messageTs: "1.1" });

    expect(result).toEqual({
      reactions: [
        { name: "eyes", count: 1, users: ["U1"] },
        { name: "thumbsup", count: 3, users: ["U1", "U2", "U3"] },
      ],
      conversationId: BOUND,
      messageTs: "1.1",
    });
  });

  it("reports a message not found rather than an empty reaction list", async () => {
    const h = harness({ boundChannelId: BOUND, channels: workspace });

    const result = await h.describeReactions({ messageTs: "9.9" });

    expect(result).toEqual({ error: "message not found" });
  });

  it("resolves reactions in another channel the bot is a member of", async () => {
    const h = harness({ boundChannelId: BOUND, channels: workspace });
    h.gw.setMessageReactions("C-GENERAL", "2.2", [
      { name: "tada", count: 1, users: ["U9"] },
    ]);

    const result = await h.describeReactions({
      conversationId: "C-GENERAL",
      messageTs: "2.2",
    });

    expect(result).toEqual({
      reactions: [{ name: "tada", count: 1, users: ["U9"] }],
      conversationId: "C-GENERAL",
      messageTs: "2.2",
    });
  });

  it("refuses a channel the bot is not a member of, pointing at /invite", async () => {
    const h = harness({ boundChannelId: BOUND, channels: workspace });

    const result = await h.describeReactions({
      conversationId: "C-STAFF",
      messageTs: "1.1",
    });

    expect(result).toMatchObject({
      error: expect.stringContaining("/invite"),
    });
  });

  it("surfaces a gateway error (e.g. a missing scope) as a value", async () => {
    const h = harness({
      boundChannelId: BOUND,
      channels: workspace,
      getMessageReactions: async () => {
        throw new Error("missing_scope");
      },
    });

    const result = await h.describeReactions({ messageTs: "1.1" });

    expect(result).toEqual({ error: "missing_scope" });
  });
});

describe("slack supportsMessageReactions", () => {
  it("is true when the scope is unknown (no probe has run yet)", async () => {
    const h = harness({ boundChannelId: BOUND });
    await h.worker.start("agent-1", {} as StoredChannelConfig);

    expect(await h.worker.supportsMessageReactions()).toBe(true);
  });

  it("is true once reactions:read is confirmed granted", async () => {
    const h = harness({ boundChannelId: BOUND });
    h.gw.setGrantedScopes(["chat:write", "reactions:read"]);
    await h.worker.start("agent-1", {} as StoredChannelConfig);

    expect(await h.worker.supportsMessageReactions()).toBe(true);
  });

  it("is false once reactions:read is confirmed missing", async () => {
    const h = harness({ boundChannelId: BOUND });
    h.gw.setGrantedScopes(["chat:write", "app_mentions:read"]);
    await h.worker.start("agent-1", {} as StoredChannelConfig);

    expect(await h.worker.supportsMessageReactions()).toBe(false);
  });

  it("fails open when the bot is not running", async () => {
    const h = harness({ boundChannelId: BOUND, gatewayDown: true });

    expect(await h.worker.supportsMessageReactions()).toBe(true);
  });
});

// Withholding an optional scope must degrade the one affordance it backs and
// nothing else — never fail the scope check itself, and never fail the MCP
// session the check gates.
describe("missing optional scopes never fail the gate", () => {
  it("both scopes withheld: each check resolves false, neither rejects", async () => {
    const h = harness({ boundChannelId: BOUND });
    h.gw.setGrantedScopes(["chat:write", "app_mentions:read"]);
    await h.worker.start("agent-1", {} as StoredChannelConfig);

    // Resolved as a pair, the way the MCP session gate asks for them.
    await expect(
      Promise.all([
        h.worker.supportsUserLookup(),
        h.worker.supportsMessageReactions(),
      ]),
    ).resolves.toEqual([false, false]);
  });

  it("a probe that throws is unknown, not missing — both fail open", async () => {
    const h = harness({ boundChannelId: BOUND });
    h.gw.getGrantedScopes = async () => {
      throw new Error("ratelimited");
    };
    await h.worker.start("agent-1", {} as StoredChannelConfig);

    await expect(
      Promise.all([
        h.worker.supportsUserLookup(),
        h.worker.supportsMessageReactions(),
      ]),
    ).resolves.toEqual([true, true]);
  });

  it("the aggregate keeps working through the channel manager with both withheld", async () => {
    const h = harness({ boundChannelId: BOUND });
    h.gw.setGrantedScopes(["chat:write", "app_mentions:read"]);
    await h.worker.start("agent-1", {} as StoredChannelConfig);
    const manager = createChannelManager({ slackWorker: h.worker });

    // This pair is exactly what mountMcpRoutes awaits before building a
    // session — a rejection here would deny the agent its MCP endpoint
    // outright rather than just dropping two tools.
    await expect(
      Promise.all([
        manager.supportsUserLookup(),
        manager.supportsMessageReactions(),
      ]),
    ).resolves.toEqual([false, false]);

    // The unaffected affordances are untouched by the withheld scopes.
    expect(
      await manager.listConversations("agent-1", ChannelType.Slack),
    ).toEqual([{ id: BOUND, title: BOUND }]);

    await manager.stopAll();
  });
});
