import { createInspectableTtlStore } from "../helpers/ttl-store.js";
import { describe, it, expect, beforeEach } from "vitest";
import type { AgentsService } from "api-server-api";
import type { ContentBlock } from "@agentclientprotocol/sdk/dist/schema/types.gen.js";
import {
  createSlackWorker,
  type SlackOAuthPending,
} from "../../modules/channels/infrastructure/slack.js";
import { createFakeSlackGateway } from "../../modules/channels/infrastructure/fake-slack-gateway.js";
import type { AcpClient } from "../../core/acp-client.js";
import { configureLogger } from "../../core/logger.js";
import {
  EventType,
  type ChannelTurnRelayed,
  type DomainEvent,
} from "../../events.js";
import type { StoredChannelConfig } from "../../modules/channels/stored-channel.js";

const OWNER = "kc|owner-1";
const USER = "U-DM-USER";

const logLines: string[] = [];
configureLogger({ level: "info", write: (l) => logLines.push(l) });
beforeEach(() => {
  logLines.length = 0;
});

type Binding = {
  instanceName: string;
  owner: string;
} | null;

function harness(opts: { binding: Binding }) {
  const gw = createFakeSlackGateway();
  const events: DomainEvent[] = [];
  const prompts: Array<string | ContentBlock[]> = [];
  const { store: pending, map: pendingMap } =
    createInspectableTtlStore<SlackOAuthPending>();
  const acp: AcpClient = {
    listSessions: async () => [],
    sendPrompt: async (prompt) => {
      prompts.push(prompt);
      return "the answer";
    },
    triggerSession: () => Promise.reject(new Error("unused")),
  };
  const agents = {
    ensureReady: async () => {},
  } as unknown as AgentsService;

  const worker = createSlackWorker(
    () => acp,
    () => gw,
    () => agents,
    { resolve: async () => null } as never,
    {
      keycloakExternalUrl: "http://kc",
      keycloakUrl: "http://kc",
      keycloakRealm: "platform",
      keycloakClientId: "c",
      callbackUrl: "http://ui/api/slack/oauth/callback",
    } as never,
    pending,
    async () => OWNER,
    { resolveSlackBinding: async () => opts.binding } as never,
    async () => {},
    async () => {},
    { name: "DAM", short: "dam" },
    async () => true,
    "http://ui",
    (e) => events.push(e),
  );

  return {
    gw,
    events,
    prompts,
    pending,
    pendingMap,
    async start() {
      await worker.start("agent-1", {} as StoredChannelConfig);
    },
    async directMessage(text: string, channel = "D-USER") {
      await this.start();
      await gw.fireDirectMessage({
        user: USER,
        channel,
        ts: "1.1",
        text,
        channelType: "im",
      });
    },
    async groupMention(text: string, channel = "G-GROUP") {
      await this.start();
      await gw.fireMention({
        user: USER,
        channel,
        ts: "1.1",
        text,
        channelType: "mpim",
      });
    },
    async command(text: string, channelId: string) {
      await this.start();
      return gw.fireCommand({ text, userId: "U-7", channelId });
    },
    texts: () => gw.readOutbound().map((r) => ("text" in r ? r.text : "")),
    turnEvents: () =>
      events.filter(
        (e): e is ChannelTurnRelayed => e.type === EventType.ChannelTurnRelayed,
      ),
    securityRecords: () =>
      logLines.map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

const boundDm: Binding = {
  instanceName: "agent-1",
  owner: OWNER,
};

describe("slack 1:1 DM", () => {
  it("relays a plain DM message (no @mention) when the DM is bound", async () => {
    const h = harness({ binding: boundDm });
    await h.directMessage("hello privately");

    expect(h.turnEvents()).toHaveLength(1);
    const turn = h.turnEvents()[0]!;
    expect(turn.outcome).toBe("success");
    // Shared binding: attributed by Slack identity, no platform sub.
    expect(turn.actorSub).toBe(null);
    expect(turn.externalActorId).toBe(USER);
  });

  it("does not speaker-label the prompt — a 1:1 DM has a single human", async () => {
    const h = harness({ binding: boundDm });
    await h.directMessage("hello privately");

    expect(h.prompts).toHaveLength(1);
    const prompt = String(h.prompts[0]);
    expect(prompt).toContain("hello privately");
    expect(prompt).not.toContain("<@");
  });

  it("logs a basis:'place' allow keyed on the DM conversation", async () => {
    const h = harness({ binding: boundDm });
    await h.directMessage("hello privately", "D-42");

    const allows = h
      .securityRecords()
      .filter((r) => r.msg === "channel.authz" && r.decision === "allow");
    expect(allows).toHaveLength(1);
    expect(allows[0]!.detail).toMatchObject({
      basis: "place",
      slackUserId: USER,
      channelId: "D-42",
    });
  });

  it("unbound DM: points at /dam bind and relays nothing", async () => {
    const h = harness({ binding: null });
    await h.directMessage("anyone home?");

    const joined = h.texts().join("\n");
    expect(joined).toContain("isn't connected");
    expect(joined).toContain("/dam bind");
    expect(h.turnEvents()).toHaveLength(0);
    expect(h.prompts).toHaveLength(0);
  });

  it("drops an app_mention duplicate in a DM (message.im is the source of truth)", async () => {
    // A DM @mention can arrive on both paths; message.im owns it, so the
    // mention path must be a no-op to avoid processing the turn twice.
    const h = harness({ binding: boundDm });
    await h.start();
    await h.gw.fireMention({
      user: USER,
      channel: "D-USER",
      ts: "1.1",
      text: "hey <@BOT>",
    });

    expect(h.turnEvents()).toHaveLength(0);
    expect(h.texts().join("\n")).toBe("");
    expect(h.prompts).toHaveLength(0);
  });
});

describe("slack group DM (mpim)", () => {
  it("relays a bound group-DM mention, speaker-labelled (multi-speaker)", async () => {
    const h = harness({ binding: boundDm });
    await h.groupMention("hey <@BOT> help");

    expect(h.turnEvents()[0]?.outcome).toBe("success");
    expect(String(h.prompts[0])).toContain(`<@${USER}>: `);
  });

  it("unbound group DM: points at /dam bind with group wording", async () => {
    const h = harness({ binding: null });
    await h.groupMention("hey <@BOT>");

    const joined = h.texts().join("\n");
    expect(joined).toContain("group");
    expect(joined).toContain("/dam bind");
    expect(h.turnEvents()).toHaveLength(0);
  });
});

describe("slack /bind in a DM", () => {
  it("acks DM-specific copy and stores a bind-intent flow for the DM id", async () => {
    const h = harness({ binding: null });
    const ack = await h.command("bind", "D-7");

    expect(ack).toContain("this DM");
    const entries = [...h.pendingMap.values()];
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      intent: "bind",
      channelId: "D-7",
      slackUserId: "U-7",
    });
  });
});
