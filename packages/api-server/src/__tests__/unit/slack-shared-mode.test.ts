import { describe, it, expect, beforeEach } from "vitest";
import type { AgentsService } from "api-server-api";
import type { ContentBlock } from "@agentclientprotocol/sdk/dist/schema/types.gen.js";
import { createSlackWorker } from "../../modules/channels/infrastructure/slack.js";
import { createFakeSlackGateway } from "../../modules/channels/infrastructure/fake-slack-gateway.js";
import type { AcpClient } from "../../core/acp-client.js";
import { configureLogger } from "../../core/logger.js";
import {
  emit as emitGlobal,
  EventType,
  type ChannelTurnRelayed,
  type DomainEvent,
  type ForeignReplyReceived,
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
  mode?: "shared" | "person-scoped";
} | null;

function harness(opts: {
  binding: Binding;
  /** identityLinks.resolve result — null = unlinked Slack user. */
  linkedSub?: string | null;
  isAllowedUser?: boolean;
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
    isAllowedUser: async () => opts.isAllowedUser ?? false,
  } as unknown as AgentsService;

  const worker = createSlackWorker(
    () => acp,
    () => gw,
    () => agents,
    { resolve: async () => opts.linkedSub ?? null } as never,
    { authUrl: "http://kc", clientId: "c" } as never,
    new Map(),
    async () => OWNER,
    { resolveSlackBinding: async () => opts.binding } as never,
    "dam",
    async (sub) => opts.termsAccepted?.(sub) ?? true,
    "http://ui",
    () => acp,
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

const shared: Binding = {
  instanceName: "agent-1",
  owner: OWNER,
  mode: "shared",
};

describe("slack shared-mode access (ADR-075)", () => {
  it("shared: relays a mention from an arbitrary channel member — no login, no allow-list", async () => {
    const h = harness({ binding: shared });
    await h.mention(STRANGER);

    expect(h.texts()).toContain("the answer");
    const joined = h.texts().join("\n");
    expect(joined).not.toContain("link your account");
    expect(joined).not.toContain("don't have access");
  });

  it("shared: attributes the turn by Slack identity, not a platform sub", async () => {
    const h = harness({ binding: shared });
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

  it("shared: blocks the turn until the BINDING owner accepts the Terms of Use", async () => {
    const h = harness({
      binding: shared,
      termsAccepted: (sub) => sub !== OWNER,
    });
    await h.mention(STRANGER);

    const joined = h.texts().join("\n");
    expect(joined).toContain("its owner must accept the Terms of Use");
    expect(joined).not.toContain("the answer");
    expect(h.turnEvents()).toHaveLength(0);
  });

  it("shared: labels the prompt with the speaker's Slack id", async () => {
    const h = harness({ binding: shared });
    await h.mention(STRANGER);

    expect(h.prompts).toHaveLength(1);
    expect(String(h.prompts[0])).toMatch(/^<@U-STRANGER>: /);
  });

  it("mode absent: an unlinked stranger gets the login deny (person-scoped default)", async () => {
    const h = harness({
      binding: { instanceName: "agent-1", owner: OWNER },
    });
    await h.mention(STRANGER);

    expect(h.texts().join("\n")).toContain("/dam login");
    expect(h.turnEvents()).toHaveLength(0);
    expect(h.prompts).toHaveLength(0);
  });

  it("explicit 'person-scoped' behaves identically to absent", async () => {
    const h = harness({
      binding: { instanceName: "agent-1", owner: OWNER, mode: "person-scoped" },
    });
    await h.mention(STRANGER);

    expect(h.texts().join("\n")).toContain("/dam login");
    expect(h.turnEvents()).toHaveLength(0);
    expect(h.prompts).toHaveLength(0);
  });

  it("person-scoped: a linked, allow-listed non-owner takes the foreign fork path", async () => {
    const h = harness({
      binding: { instanceName: "agent-1", owner: OWNER },
      linkedSub: "kc|member-2",
      isAllowedUser: true,
    });
    await h.mention(STRANGER);

    const foreign = h.events.filter(
      (e): e is ForeignReplyReceived =>
        e.type === EventType.ForeignReplyReceived,
    );
    expect(foreign).toHaveLength(1);
    expect(foreign[0]!.foreignSub).toBe("kc|member-2");
    expect(foreign[0]!.agentId).toBe("agent-1");
    expect(foreign[0]!.slackContext).toEqual({
      channelId: "C1",
      userSlackId: STRANGER,
    });
    // The owner relay never ran.
    expect(h.prompts).toHaveLength(0);

    // Settle the fork subscription and confirm the outcome wiring.
    emitGlobal({
      type: EventType.ForkFailed,
      forkId: "fork-1",
      replyId: foreign[0]!.replyId,
      reason: "PodNotReady",
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(h.turnEvents()).toHaveLength(1);
    const turn = h.turnEvents()[0]!;
    expect(turn.actorSub).toBe("kc|member-2");
    expect(turn.forkId).toBe("fork-1");
    expect(turn.reason).toBe("fork-failed:PodNotReady");
  });

  it("shared: logs a basis:'place' allow entry in the security audit trail", async () => {
    const h = harness({ binding: shared });
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
