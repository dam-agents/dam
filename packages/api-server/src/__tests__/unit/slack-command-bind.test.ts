import { createInspectableTtlStore } from "../helpers/ttl-store.js";
import { describe, it, expect } from "vitest";
import type { AgentsService } from "api-server-api";
import {
  createSlackWorker,
  type SlackOAuthPending,
} from "../../modules/channels/infrastructure/slack.js";
import { createFakeSlackGateway } from "../../modules/channels/infrastructure/fake-slack-gateway.js";
import { stubTurnAttendance } from "../helpers/turn-attendance.js";
import { stubWorkspaceFiles } from "../helpers/workspace-files.js";
import type { AcpClient } from "../../core/acp-client.js";
import { configureLogger } from "../../core/logger.js";
import { EventType, type DomainEvent } from "../../events.js";
import type { StoredChannelConfig } from "../../modules/channels/stored-channel.js";

const OWNER = "kc|owner-1";
configureLogger({ level: "error", write: () => {} });

type Binding = {
  instanceName: string;
  owner: string;
} | null;

function harness(opts: {
  binding: Binding;
  linkedSub?: string | null;
  agentOwner?: string | null;
}) {
  const gw = createFakeSlackGateway();
  const events: DomainEvent[] = [];
  const { store: pending, map: pendingMap } =
    createInspectableTtlStore<SlackOAuthPending>();
  const unbindCalls: string[] = [];
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
    {
      resolveSlackBindings: async () =>
        opts.binding
          ? [
              {
                instanceName: opts.binding.instanceName,
                owner: opts.binding.owner,
                ambient: false,
                isDefault: true,
              },
            ]
          : [],
    } as never,
    async (_agentId: string, ch: string) => {
      unbindCalls.push(ch);
    },
    async () => {},
    async () => true,
    { name: "DAM", short: "dam" },
    async () => true,
    "http://ui",
    stubTurnAttendance(),
    stubWorkspaceFiles(),
    (e) => events.push(e),
  );

  return {
    gw,
    events,
    pending,
    pendingMap,
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
};

describe("slack /bind command", () => {
  it("on an unbound channel acks a connect link and stores a bind-intent pending flow", async () => {
    const h = harness({ binding: null });
    const ack = await h.command("bind", "U-7", "C-9");
    expect(ack).toContain("Connect an agent");
    const entries = [...h.pendingMap.values()];
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      intent: "bind",
      channelId: "C-9",
      slackUserId: "U-7",
    });
  });

  /**
   * TEST_SCENARIO: a channel already serving an agent still offers a connect
   * link — a second agent joins it rather than replacing the first.
   */
  it("on an already-connected channel still acks a link, naming who is there", async () => {
    const h = harness({ binding: bound });
    const ack = await h.command("bind");
    expect(ack).toContain("Connect an agent");
    expect(ack).toContain("Already connected here");
    expect(ack).toContain("joins them rather than replacing them");
    expect(h.pendingMap.size).toBe(1);
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
      binding: { instanceName: "agent-1", owner: "kc|binder" },
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
