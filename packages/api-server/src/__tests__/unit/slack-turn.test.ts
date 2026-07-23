import { describe, it, expect } from "vitest";
import type { AgentsService } from "api-server-api";
import { createSlackWorker } from "../../modules/channels/infrastructure/slack.js";
import { createFakeSlackGateway } from "../../modules/channels/infrastructure/fake-slack-gateway.js";
import type {
  AcpClient,
  PromptUpdate,
  SendPromptOpts,
} from "../../core/acp-client.js";
import {
  emit as emitGlobal,
  EventType,
  type ChannelTurnRelayed,
  type DomainEvent,
  type ForeignReplyReceived,
} from "../../events.js";
import { AgentWakeTimeoutError } from "../../modules/agents/index.js";
import type { StoredChannelConfig } from "../../modules/channels/stored-channel.js";

const OWNER = "kc|owner-1";

type SendPromptFn = (
  prompt: string | Array<unknown>,
  opts: SendPromptOpts,
) => Promise<string>;

/** Drives opts.onUpdate with `updates`, then resolves with `response`. The
 *  response is deliberately never posted — the agent replies via the `reply`
 *  tool, which tests exercise directly on the worker. */
function scripted(updates: PromptUpdate[], response: string): SendPromptFn {
  return async (_prompt, opts) => {
    for (const u of updates) opts.onUpdate?.(u);
    return response;
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function harness(opts: {
  sendPrompt?: SendPromptFn;
  forkSendPrompt?: SendPromptFn;
  listSessions?: AcpClient["listSessions"];
  ensureReady?: AgentsService["ensureReady"];
  isAllowedUser?: boolean;
  linkedSub?: string | null;
}) {
  const gw = createFakeSlackGateway();
  const events: DomainEvent[] = [];
  const acp: AcpClient = {
    listSessions: opts.listSessions ?? (async () => []),
    sendPrompt: opts.sendPrompt ?? scripted([], "the answer"),
    triggerSession: () => Promise.reject(new Error("unused")),
  };
  const forkAcp: AcpClient = {
    listSessions: async () => [],
    sendPrompt: opts.forkSendPrompt ?? scripted([], "fork answer"),
    triggerSession: () => Promise.reject(new Error("unused")),
  };
  const agents = {
    ensureReady: opts.ensureReady ?? (async () => {}),
    isAllowedUser: async () => opts.isAllowedUser ?? false,
  } as unknown as AgentsService;

  const worker = createSlackWorker(
    () => acp,
    () => gw,
    () => agents,
    { resolve: async () => opts.linkedSub ?? OWNER } as never,
    { authUrl: "http://kc", clientId: "c" } as never,
    new Map(),
    async () => OWNER,
    {
      resolveSlackBinding: async () => ({
        instanceName: "agent-1",
        owner: OWNER,
      }),
      resolveSlackChannelByInstance: async () => "C1",
    } as never,
    async () => {},
    async () => {},
    { name: "DAM", short: "dam" },
    async () => true,
    "http://ui",
    () => forkAcp,
    (e) => events.push(e),
  );

  return {
    gw,
    events,
    worker,
    async start() {
      await worker.start("agent-1", {} as StoredChannelConfig);
    },
    async mention(over?: { user?: string; teamId?: string }) {
      await worker.start("agent-1", {} as StoredChannelConfig);
      await gw.fireMention({
        user: over?.user ?? "U1",
        channel: "C1",
        ts: "1.1",
        text: "hi agent",
        teamId: "teamId" in (over ?? {}) ? over?.teamId : "T-e2e",
      });
    },
    records: () => gw.readOutbound(),
    turnEvents: () =>
      events.filter(
        (e): e is ChannelTurnRelayed => e.type === EventType.ChannelTurnRelayed,
      ),
  };
}

describe("slack turn presentation — owner turns", () => {
  it("drives a status and never auto-posts a reply or an ack reaction", async () => {
    const h = harness({
      sendPrompt: scripted(
        [{ kind: "text", text: "an answer the agent would normally post" }],
        "an answer the agent would normally post",
      ),
    });
    await h.mention();
    await tick();

    const recs = h.records();
    // The platform presents only the working status on the agent's behalf. The
    // reply text is NOT delivered, and there is no automatic ack reaction — any
    // reaction is the agent's own doing via the `react` tool.
    expect(recs.some((r) => r.kind === "status")).toBe(true);
    expect(recs.some((r) => r.kind === "reaction")).toBe(false);
    expect(recs.some((r) => r.kind === "message")).toBe(false);
    expect(recs.some((r) => r.kind === "stream_start")).toBe(false);
    expect(h.turnEvents()[0]!.outcome).toBe("success");
  });

  it("sets a thinking status at the start and clears it at the end", async () => {
    const h = harness({});
    await h.mention();
    await tick();

    const recs = h.records();
    const statuses = recs.filter((r) => r.kind === "status");
    expect(statuses[0]).toMatchObject({ status: "is thinking…" });
    expect(statuses.at(-1)).toMatchObject({ status: "" });
  });

  it("posts failure copy and clears status when the turn errors", async () => {
    const h = harness({
      sendPrompt: async () => {
        throw new Error("boom");
      },
    });
    await h.mention();
    await tick();

    const recs = h.records();
    const msgs = recs.filter((r) => r.kind === "message");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ text: expect.stringContaining("Error:") });
    expect(recs.filter((r) => r.kind === "status").at(-1)).toMatchObject({
      status: "",
    });
    expect(h.turnEvents()[0]!.outcome).toBe("failure");
    expect(h.turnEvents()[0]!.reason).toBe("acp-error");
  });

  it("posts a still-starting note across a transient wake retry", async () => {
    let ready = 0;
    const h = harness({
      ensureReady: async (_id, o) => {
        ready += 1;
        o?.onWaking?.();
        if (ready === 1) {
          throw new AgentWakeTimeoutError({
            agentId: "agent-1",
            timeoutMs: 120_000,
            durationMs: 120_100,
            failure: { kind: "agent-pod-not-ready" },
          });
        }
      },
    });
    await h.mention();
    await tick();

    expect(ready).toBe(2);
    const recs = h.records();
    expect(
      recs.some(
        (r) => r.kind === "message" && r.text.includes("still starting"),
      ),
    ).toBe(true);
    expect(h.turnEvents()[0]!.outcome).toBe("success");
  });
});

describe("slack turn presentation — foreign fork turns", () => {
  it("shows and clears a status, without auto-posting the fork reply", async () => {
    const h = harness({
      isAllowedUser: true,
      linkedSub: "kc|member-2",
      forkSendPrompt: scripted([], "fork answer"),
    });
    await h.mention({ user: "U-STRANGER" });

    const foreign = h.events.find(
      (e): e is ForeignReplyReceived =>
        e.type === EventType.ForeignReplyReceived,
    );
    expect(foreign).toBeDefined();

    emitGlobal({
      type: EventType.ForkReady,
      forkId: "fork-1",
      replyId: foreign!.replyId,
      podIP: "10.0.0.5",
    });
    await tick();

    const recs = h.records();
    // No automatic ack reaction; the working status is the only thing the
    // platform posts on the fork's behalf, and it clears at the end.
    expect(recs.some((r) => r.kind === "reaction")).toBe(false);
    expect(recs.some((r) => r.kind === "status")).toBe(true);
    expect(recs.some((r) => r.kind === "message")).toBe(false);
    expect(recs.filter((r) => r.kind === "status").at(-1)).toMatchObject({
      status: "",
    });
    const turn = h.turnEvents()[0]!;
    expect(turn.outcome).toBe("success");
    expect(turn.forkId).toBe("fork-1");
  });

  it("clears status when the fork fails", async () => {
    const h = harness({
      isAllowedUser: true,
      linkedSub: "kc|member-2",
    });
    await h.mention({ user: "U-STRANGER" });

    const foreign = h.events.find(
      (e): e is ForeignReplyReceived =>
        e.type === EventType.ForeignReplyReceived,
    );
    emitGlobal({
      type: EventType.ForkFailed,
      forkId: "fork-1",
      replyId: foreign!.replyId,
      reason: "PodNotReady",
    });
    await tick();

    const recs = h.records();
    expect(recs.filter((r) => r.kind === "status").at(-1)).toMatchObject({
      status: "",
    });
    expect(
      recs.some(
        (r) => r.kind === "ephemeral" && r.text.includes("PodNotReady"),
      ),
    ).toBe(true);
  });
});

describe("slack reply / react tools", () => {
  it("reply posts into the current turn's thread with the agent footer", async () => {
    const h = harness({});
    await h.mention(); // sets the active turn (thread 1.1, message 1.1)
    await tick();
    h.gw.resetOutbound();

    const result = await h.worker.reply("agent-1", { text: "here you go" });
    expect(result).toEqual({ ok: true });

    const msgs = h.records().filter((r) => r.kind === "message");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({
      channel: "C1",
      threadTs: "1.1",
      text: "here you go",
    });
  });

  it("reply honours an explicit threadTs override", async () => {
    const h = harness({});
    await h.mention();
    await tick();
    h.gw.resetOutbound();

    await h.worker.reply("agent-1", { text: "elsewhere", threadTs: "9.9" });
    const msgs = h.records().filter((r) => r.kind === "message");
    expect(msgs[0]).toMatchObject({ threadTs: "9.9" });
  });

  it("reply errors when there is no active thread and none is given", async () => {
    const h = harness({});
    await h.start();
    const result = await h.worker.reply("agent-1", { text: "orphan" });
    expect(result).toMatchObject({
      error: expect.stringContaining("no active thread"),
    });
    expect(h.records().some((r) => r.kind === "message")).toBe(false);
  });

  it("react adds the emoji to the current turn's message", async () => {
    const h = harness({});
    await h.mention();
    await tick();
    h.gw.resetOutbound();

    const result = await h.worker.react("agent-1", {
      emoji: ":white_check_mark:",
    });
    expect(result).toEqual({ ok: true });

    const reactions = h.records().filter((r) => r.kind === "reaction");
    expect(reactions).toHaveLength(1);
    // Colons are stripped; targets the triggering message.
    expect(reactions[0]).toMatchObject({
      channel: "C1",
      ts: "1.1",
      name: "white_check_mark",
    });
  });

  it("react errors on an empty emoji", async () => {
    const h = harness({});
    await h.mention();
    await tick();
    h.gw.resetOutbound();

    const result = await h.worker.react("agent-1", { emoji: "  " });
    expect(result).toMatchObject({ error: expect.stringContaining("emoji") });
    expect(h.records().some((r) => r.kind === "reaction")).toBe(false);
  });
});
