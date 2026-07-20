import { describe, it, expect } from "vitest";
import type { AgentsService } from "api-server-api";
import {
  createSlackWorker,
  type SlackOAuthPending,
} from "../../modules/channels/infrastructure/slack.js";
import { createFakeSlackGateway } from "../../modules/channels/infrastructure/fake-slack-gateway.js";
import type { AcpClient } from "../../core/acp-client.js";
import { configureLogger } from "../../core/logger.js";
import { EventType, type DomainEvent } from "../../events.js";
import type { StoredChannelConfig } from "../../modules/channels/stored-channel.js";

const OWNER = "kc|owner-1";
configureLogger({ level: "error", write: () => {} });

type Binding = {
  instanceName: string;
  owner: string;
  mode?: "shared" | "person-scoped";
} | null;

function harness(opts: {
  binding: Binding;
  /** identityLinks.resolve result — null = unlinked Slack user. */
  linkedSub?: string | null;
  /** getInstanceOwner result — the agent's owner. */
  agentOwner?: string | null;
}) {
  const gw = createFakeSlackGateway();
  const events: DomainEvent[] = [];
  const pending = new Map<string, SlackOAuthPending>();
  const unbindCalls: string[] = [];
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
    { resolve: async () => opts.linkedSub ?? null } as never,
    {
      keycloakExternalUrl: "http://kc",
      keycloakUrl: "http://kc",
      keycloakRealm: "platform",
      keycloakClientId: "c",
      callbackUrl: "http://ui/api/slack/oauth/callback",
    },
    pending,
    async () => opts.agentOwner ?? OWNER,
    { resolveSlackBinding: async () => opts.binding } as never,
    async (ch) => {
      unbindCalls.push(ch);
    },
    "dam",
    async () => true,
    "http://ui",
    () => acp,
    (e) => events.push(e),
  );

  return {
    gw,
    events,
    pending,
    unbindCalls,
    async command(text: string, userId = "U-1", channelId = "C-1") {
      await worker.start("agent-1", {} as StoredChannelConfig);
      return gw.fireCommand({ text, userId, channelId });
    },
  };
}

const bound: Binding = {
  instanceName: "agent-1",
  owner: OWNER,
  mode: "shared",
};

describe("slack /bind command", () => {
  it("on an unbound channel acks a connect link and stores a bind-intent pending flow", async () => {
    const h = harness({ binding: null });
    const ack = await h.command("bind", "U-7", "C-9");
    expect(ack).toContain("Connect an agent");
    const entries = [...h.pending.values()];
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      intent: "bind",
      channelId: "C-9",
      slackUserId: "U-7",
    });
  });

  it("on an already-bound channel refuses and creates no pending flow", async () => {
    const h = harness({ binding: bound });
    const ack = await h.command("bind");
    expect(ack).toContain("already connected");
    expect(h.pending.size).toBe(0);
  });
});

describe("slack /unbind command", () => {
  it("refuses an unlinked invoker and leaves the binding", async () => {
    const h = harness({ binding: bound, linkedSub: null });
    const ack = await h.command("unbind");
    expect(ack).toContain("Link your account");
    expect(h.unbindCalls).toEqual([]);
  });

  it("refuses a linked user who is neither binder nor agent owner", async () => {
    const h = harness({
      binding: bound,
      linkedSub: "kc|stranger",
      agentOwner: "kc|other",
    });
    const ack = await h.command("unbind");
    expect(ack).toContain("Only the person");
    expect(h.unbindCalls).toEqual([]);
  });

  it("lets the binder unbind: deletes the binding and emits SlackDisconnected", async () => {
    const h = harness({ binding: bound, linkedSub: OWNER });
    const ack = await h.command("unbind", "U-1", "C-1");
    expect(ack).toContain("disconnected");
    expect(h.unbindCalls).toEqual(["C-1"]);
    expect(h.events.some((e) => e.type === EventType.SlackDisconnected)).toBe(
      true,
    );
  });

  it("lets the agent owner unbind even when they aren't the binder", async () => {
    const h = harness({
      binding: { instanceName: "agent-1", owner: "kc|binder", mode: "shared" },
      linkedSub: "kc|owner-2",
      agentOwner: "kc|owner-2",
    });
    const ack = await h.command("unbind");
    expect(ack).toContain("disconnected");
    expect(h.unbindCalls).toEqual(["C-1"]);
  });

  it("says nothing is connected when the channel is unbound", async () => {
    const h = harness({ binding: null, linkedSub: OWNER });
    const ack = await h.command("unbind");
    expect(ack).toContain("isn't connected");
    expect(h.unbindCalls).toEqual([]);
  });
});
