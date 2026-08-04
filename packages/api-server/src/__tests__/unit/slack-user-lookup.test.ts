import { createMemoryTtlStore } from "../../core/ttl-store.js";
import { describe, it, expect } from "vitest";
import type { AgentsService } from "api-server-api";
import { createSlackWorker } from "../../modules/channels/infrastructure/slack.js";
import {
  createFakeSlackGateway,
  type FakeSlackGateway,
} from "../../modules/channels/infrastructure/fake-slack-gateway.js";
import type { SlackUserInfo } from "../../modules/channels/infrastructure/slack-gateway.js";
import type { AcpClient } from "../../core/acp-client.js";
import { configureLogger } from "../../core/logger.js";
import type { StoredChannelConfig } from "../../modules/channels/stored-channel.js";

const OWNER = "kc|owner-1";
const BOUND = "C-BOUND";
configureLogger({ level: "error", write: () => {} });

const ADA: SlackUserInfo = {
  id: "U024BE7LH",
  username: "ada",
  realName: "Ada Lovelace",
  displayName: "ada",
  title: "Staff Engineer",
  pronouns: "she/her",
  email: "ada@example.com",
  timezone: "Europe/London",
  timezoneLabel: "Greenwich Mean Time",
  statusText: "heads down",
  statusEmoji: ":dart:",
  isBot: false,
  isDeleted: false,
};

const GRACE: SlackUserInfo = {
  id: "U07GRACE9",
  username: "grace",
  realName: "Grace Hopper",
  isBot: false,
};

function harness(opts: {
  /** null = agent has no Slack binding. */
  boundChannelId: string | null;
  users?: SlackUserInfo[];
  /** Make the gateway fail to start, so ensureGateway yields null. */
  gatewayDown?: boolean;
  /** Replace getUserInfo, e.g. to make Slack throw. */
  getUserInfo?: FakeSlackGateway["getUserInfo"];
}) {
  const gw = createFakeSlackGateway();
  gw.setUsers(opts.users ?? []);
  if (opts.getUserInfo) gw.getUserInfo = opts.getUserInfo;
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
      resolveSlackBinding: async () => null,
      resolveSlackChannelsByInstance: async () =>
        opts.boundChannelId ? [opts.boundChannelId] : [],
    },
    async () => {},
    async () => {},
    { name: "DAM", short: "dam" },
    async () => true,
    "http://ui",
    () => {},
  );

  return {
    gw,
    worker,
    async describeUsers(userIds: string[]) {
      await worker.start("agent-1", {} as StoredChannelConfig);
      return worker.describeUsers("agent-1", userIds);
    },
  };
}

describe("slack user lookup", () => {
  it("unbound agent: the binding gates the directory too", async () => {
    const h = harness({ boundChannelId: null, users: [ADA] });

    expect(await h.describeUsers(["U024BE7LH"])).toEqual({
      error: "no channel connected",
    });
    // Nothing reached Slack — no binding, no read.
    expect(h.gw.readUserLookups()).toEqual([]);
  });

  it("errors when the bot is not running", async () => {
    const h = harness({
      boundChannelId: BOUND,
      users: [ADA],
      gatewayDown: true,
    });

    expect(await h.describeUsers(["U024BE7LH"])).toEqual({
      error: "slack bot not running",
    });
  });

  it("resolves ids to the whole profile", async () => {
    const h = harness({ boundChannelId: BOUND, users: [ADA] });

    expect(await h.describeUsers(["U024BE7LH"])).toEqual({ users: [ADA] });
  });

  it("accepts the <@U…> spelling the prompt shows", async () => {
    const h = harness({ boundChannelId: BOUND, users: [ADA] });

    const result = await h.describeUsers(["<@U024BE7LH|ada>"]);

    expect(result).toEqual({ users: [ADA] });
    expect(h.gw.readUserLookups()).toEqual(["U024BE7LH"]);
  });

  it("returns one entry per person, however often an id is repeated", async () => {
    const h = harness({ boundChannelId: BOUND, users: [ADA] });

    const result = await h.describeUsers([
      "U024BE7LH",
      "<@U024BE7LH>",
      "u024be7lh",
    ]);

    expect(result).toEqual({ users: [ADA] });
    expect(h.gw.readUserLookups()).toEqual(["U024BE7LH"]);
  });

  it("marks the ids it cannot resolve and keeps the rest of the batch", async () => {
    const h = harness({ boundChannelId: BOUND, users: [ADA, GRACE] });

    const result = await h.describeUsers([
      "U024BE7LH",
      "U0GONE123",
      "@ada",
      "U07GRACE9",
    ]);

    expect(result).toEqual({
      users: [
        ADA,
        { id: "U0GONE123", error: "no such user in this workspace" },
        {
          id: "@ada",
          error:
            "not a Slack user id — pass the U… id as it appears in the conversation",
        },
        GRACE,
      ],
    });
    // A handle is rejected without asking Slack.
    expect(h.gw.readUserLookups()).toEqual([
      "U024BE7LH",
      "U0GONE123",
      "U07GRACE9",
    ]);
  });

  it("fails one id, not the batch, when Slack rejects a lookup", async () => {
    const h = harness({
      boundChannelId: BOUND,
      users: [ADA],
      getUserInfo: async (userId) => {
        if (userId === "U024BE7LH") return ADA;
        throw new Error("ratelimited");
      },
    });

    const result = await h.describeUsers(["U024BE7LH", "U07GRACE9"]);

    expect(result).toEqual({
      users: [ADA, { id: "U07GRACE9", error: "ratelimited" }],
    });
  });

  it("caches hits and misses — a channel's regulars are asked about every turn", async () => {
    const h = harness({ boundChannelId: BOUND, users: [ADA] });

    await h.describeUsers(["U024BE7LH", "U0GONE123"]);
    const second = await h.describeUsers(["U024BE7LH", "U0GONE123"]);

    expect(second).toEqual({
      users: [
        ADA,
        { id: "U0GONE123", error: "no such user in this workspace" },
      ],
    });
    expect(h.gw.readUserLookups()).toEqual(["U024BE7LH", "U0GONE123"]);
  });

  it("posts nothing — a lookup is a read", async () => {
    const h = harness({ boundChannelId: BOUND, users: [ADA] });

    await h.describeUsers(["U024BE7LH"]);

    expect(h.gw.readOutbound()).toHaveLength(0);
  });
});

describe("slack supportsUserLookup", () => {
  it("is true when the scope is unknown (no probe has run yet)", async () => {
    const h = harness({ boundChannelId: BOUND });
    await h.worker.start("agent-1", {} as StoredChannelConfig);

    expect(await h.worker.supportsUserLookup()).toBe(true);
  });

  it("is true once users:read is confirmed granted", async () => {
    const h = harness({ boundChannelId: BOUND });
    h.gw.setGrantedScopes(["chat:write", "users:read", "users:read.email"]);
    await h.worker.start("agent-1", {} as StoredChannelConfig);

    expect(await h.worker.supportsUserLookup()).toBe(true);
  });

  it("is false once users:read is confirmed missing", async () => {
    const h = harness({ boundChannelId: BOUND });
    h.gw.setGrantedScopes(["chat:write", "app_mentions:read"]);
    await h.worker.start("agent-1", {} as StoredChannelConfig);

    expect(await h.worker.supportsUserLookup()).toBe(false);
  });

  it("fails open when the bot is not running", async () => {
    const h = harness({ boundChannelId: BOUND, gatewayDown: true });

    expect(await h.worker.supportsUserLookup()).toBe(true);
  });
});
