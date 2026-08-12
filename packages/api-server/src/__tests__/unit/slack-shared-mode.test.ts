import { createMemoryTtlStore } from "../../core/ttl-store.js";
import { describe, it, expect, beforeEach } from "vitest";
import type { AgentsService } from "api-server-api";
import type { ContentBlock } from "@agentclientprotocol/sdk/dist/schema/types.gen.js";
import { createSlackWorker } from "../../modules/channels/infrastructure/slack.js";
import { createFakeSlackGateway } from "../../modules/channels/infrastructure/fake-slack-gateway.js";
import { stubTurnAttendance } from "../helpers/turn-attendance.js";
import { stubWorkspaceFiles } from "../helpers/workspace-files.js";
import type { AcpClient } from "../../core/acp-client.js";
import { configureLogger } from "../../core/logger.js";
import {
  EventType,
  type ChannelTurnRelayed,
  type DomainEvent,
} from "../../events.js";
import type { StoredChannelConfig } from "../../modules/channels/stored-channel.js";

const OWNER = "kc|owner-1";
const STRANGER = "U-STRANGER";

// Capture securityLog lines (it writes through the process-wide Pino logger).
const logLines: string[] = [];
configureLogger({ level: "info", write: (l) => logLines.push(l) });
beforeEach(() => {
  logLines.length = 0;
});

type Binding = {
  instanceName: string;
  owner: string;
} | null;

function harness(opts: {
  binding: Binding;
  termsAccepted?: (sub: string) => boolean;
}) {
  const gw = createFakeSlackGateway();
  const events: DomainEvent[] = [];
  const prompts: Array<string | ContentBlock[]> = [];
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
    { authUrl: "http://kc", clientId: "c" } as never,
    createMemoryTtlStore(600_000),
    async () => OWNER,
    { resolveSlackBinding: async () => opts.binding } as never,
    async () => {},
    async () => {},
    { name: "DAM", short: "dam" },
    async (sub) => opts.termsAccepted?.(sub) ?? true,
    "http://ui",
    stubTurnAttendance(),
    stubWorkspaceFiles(),
    (e) => events.push(e),
  );

  return {
    gw,
    events,
    prompts,
    async mention(user: string) {
      await worker.start("agent-1", {} as StoredChannelConfig);
      await gw.fireMention({
        user,
        channel: "C1",
        ts: "1.1",
        text: "hi agent",
      });
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

const bound: Binding = {
  instanceName: "agent-1",
  owner: OWNER,
};

describe("slack shared-channel access", () => {
  it("relays a mention from an arbitrary channel member — no login, no allow-list", async () => {
    const h = harness({ binding: bound });
    await h.mention(STRANGER);

    // The turn is relayed and succeeds — no login prompt, no allow-list block.
    // (The reply itself only lands if the agent calls the `reply` tool.)
    expect(h.turnEvents()[0]?.outcome).toBe("success");
    const joined = h.texts().join("\n");
    expect(joined).not.toContain("link your account");
    expect(joined).not.toContain("don't have access");
  });

  it("attributes the turn by Slack identity, not a platform sub", async () => {
    const h = harness({ binding: bound });
    await h.mention(STRANGER);

    expect(h.turnEvents()).toHaveLength(1);
    const turn = h.turnEvents()[0]!;
    expect(turn.actorSub).toBe(null);
    expect(turn.externalActorId).toBe(STRANGER);
    expect(turn.outcome).toBe("success");
  });

  it("unbound channel: 'No instance connected' ephemeral and no turn event", async () => {
    const h = harness({ binding: null });
    await h.mention(STRANGER);

    expect(h.texts().join("\n")).toContain(
      "No instance connected to this channel.",
    );
    expect(h.turnEvents()).toHaveLength(0);
  });

  it("blocks the turn until the BINDING owner accepts the Terms of Use", async () => {
    const h = harness({
      binding: bound,
      termsAccepted: (sub) => sub !== OWNER,
    });
    await h.mention(STRANGER);

    const joined = h.texts().join("\n");
    expect(joined).toContain("its owner must accept the Terms of Use");
    expect(joined).not.toContain("the answer");
    expect(h.turnEvents()).toHaveLength(0);
  });

  it("labels the prompt with the speaker's Slack id", async () => {
    const h = harness({ binding: bound });
    await h.mention(STRANGER);

    expect(h.prompts).toHaveLength(1);
    expect(String(h.prompts[0])).toContain("<@U-STRANGER>: ");
  });

  it("logs a basis:'place' allow entry in the security audit trail", async () => {
    const h = harness({ binding: bound });
    await h.mention(STRANGER);

    const allows = h
      .securityRecords()
      .filter((r) => r.msg === "channel.authz" && r.decision === "allow");
    expect(allows).toHaveLength(1);
    const entry = allows[0]!;
    expect(entry.actor).toBe(null);
    expect(entry.actorKind).toBe("external");
    expect(entry.agentId).toBe("agent-1");
    expect(entry.detail).toMatchObject({
      basis: "place",
      slackUserId: STRANGER,
      channelId: "C1",
    });
  });
});
