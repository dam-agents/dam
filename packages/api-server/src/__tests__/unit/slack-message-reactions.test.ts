import { createMemoryTtlStore } from "../../core/ttl-store.js";
import { describe, it, expect } from "vitest";
import { ChannelType, type AgentsService } from "api-server-api";
import { createSlackWorker } from "../../modules/channels/infrastructure/slack.js";
import { stubTurnAttendance } from "../helpers/turn-attendance.js";
import { stubWorkspaceFiles } from "../helpers/workspace-files.js";
import { createChannelManager } from "../../modules/channels/services/channel-manager.js";
import {
  createFakeSlackGateway,
  type FakeSlackChannel,
  type FakeSlackGateway,
} from "../../modules/channels/infrastructure/fake-slack-gateway.js";
import type { AcpClient } from "../../core/acp-client.js";
import { configureLogger } from "../../core/logger.js";

const OWNER = "kc|owner-1";
const BOUND = "C-BOUND";
configureLogger({ level: "error", write: () => {} });

const workspace: FakeSlackChannel[] = [
  { id: BOUND, name: "agent-home", botIsMember: true },
  { id: "C-GENERAL", name: "general", botIsMember: true },
  { id: "C-STAFF", name: "staff", botIsMember: false },
];

function harness(opts: {
  boundChannelId: string | null;
  channels?: FakeSlackChannel[];
  gatewayDown?: boolean;
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
    turnStatus: async () => "unknown" as const,
  } as unknown as AcpClient;
  const agents = {
    ensureReady: async () => {},
  } as unknown as AgentsService;

  const worker = createSlackWorker(
    () => acp,
    () => gw,
    () => agents,
    { resolve: async () => null } as never,
    { authUrl: "http://kc", clientId: "c" } as never,
    createMemoryTtlStore(600_000),
    async () => OWNER,
    {
      resolveSlackBindings: async () => [],
      resolveSlackChannelsByInstance: async () =>
        opts.boundChannelId ? [{ id: opts.boundChannelId, teamId: "" }] : [],
    },
    async () => {},
    async () => {},
    async () => true,
    { name: "DAM", short: "dam" },
    async () => true,
    "http://ui",
    stubTurnAttendance(),
    stubWorkspaceFiles(),
    (teamId) => teamId,
    () => {},
  );

  return {
    gw,
    worker,
    async describeReactions(
      query: Parameters<typeof worker.describeMessageReactions>[1],
    ) {
      await worker.connect().catch(() => {});
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

describe("missing optional scopes never fail the gate", () => {
  /**
   * TEST_SCENARIO: Both optional scopes are withheld. The tools stay registered
   * and each says which scope its workspace withheld, so an agent learns why it
   * cannot see something instead of meeting a tool that fails for no stated
   * reason.
   */
  it("both scopes withheld: each tool reports the scope it is missing", async () => {
    const h = harness({ boundChannelId: BOUND });
    h.gw.setGrantedScopes(["chat:write", "app_mentions:read"]);
    await h.worker.connect().catch(() => {});

    expect(await h.describeReactions({ messageTs: "1700000000.0001" })).toEqual(
      { error: expect.stringContaining("reactions:read") },
    );
  });

  /**
   * TEST_SCENARIO: The scope probe itself fails — rate limited, or the bot is
   * briefly unreachable. An unanswered check is unknown, never missing, so the
   * capability keeps working; treating a hiccup as a withheld scope would hide
   * a capability the workspace actually granted.
   */
  it("a probe that throws is unknown, not missing — the tool still answers", async () => {
    const h = harness({ boundChannelId: BOUND });
    h.gw.getGrantedScopes = async () => {
      throw new Error("ratelimited");
    };
    await h.worker.connect().catch(() => {});

    const result = await h.describeReactions({ messageTs: "1700000000.0001" });
    expect(result).not.toEqual({
      error: expect.stringContaining("reactions:read"),
    });
  });

  /**
   * TEST_SCENARIO: A withheld scope must not take anything else down with it.
   * The manager keeps serving the binding it always did.
   */
  it("the aggregate keeps working through the channel manager with both withheld", async () => {
    const h = harness({ boundChannelId: BOUND });
    h.gw.setGrantedScopes(["chat:write", "app_mentions:read"]);
    await h.worker.connect().catch(() => {});
    const manager = createChannelManager({ slackWorker: h.worker });

    expect(
      await manager.listConversations("agent-1", ChannelType.Slack),
    ).toEqual([{ id: BOUND, title: BOUND }]);

    await manager.stopAll();
  });
});
