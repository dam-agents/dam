import { describe, it, expect } from "vitest";
import type { AgentsService } from "api-server-api";
import type { SlackOutboundRecord } from "api-server-api";
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

/** A long chunk so the first flush crosses the presenter's default threshold
 *  and opens the stream deterministically. */
const BIG = "x".repeat(400);

type SendPromptFn = (
  prompt: string | Array<unknown>,
  opts: SendPromptOpts,
) => Promise<string>;

/** Drives opts.onUpdate with `updates`, then resolves with `response`. */
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

/** Concatenate the text a single stream carried (start + appends + stop). */
function streamedText(records: SlackOutboundRecord[]): string {
  let out = "";
  for (const r of records) {
    if (r.kind === "stream_start" || r.kind === "stream_append") out += r.text;
    else if (r.kind === "stream_stop" && r.text !== undefined) out += r.text;
  }
  return out;
}

describe("slack live streaming — owner turns", () => {
  it("streams the reply and never posts a plain message", async () => {
    const h = harness({
      sendPrompt: scripted(
        [
          { kind: "text", text: BIG },
          { kind: "text", text: "! done" },
        ],
        BIG + "! done",
      ),
    });
    await h.mention();
    await tick();

    const recs = h.records();
    const starts = recs.filter((r) => r.kind === "stream_start");
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({
      recipientTeamId: "T-e2e",
      recipientUserId: "U1",
    });
    expect(recs.some((r) => r.kind === "stream_stop")).toBe(true);
    expect(recs.some((r) => r.kind === "message")).toBe(false);
    expect(streamedText(recs)).toBe(BIG + "! done");
    expect(h.turnEvents()[0]!.outcome).toBe("success");
  });

  it("sets a thinking status right after the 👀 and clears it at the end", async () => {
    const h = harness({
      sendPrompt: scripted([{ kind: "text", text: BIG }], BIG),
    });
    await h.mention();
    await tick();

    const recs = h.records();
    const kinds = recs.map((r) => r.kind);
    expect(kinds.indexOf("reaction")).toBeLessThan(kinds.indexOf("status"));
    const statuses = recs.filter((r) => r.kind === "status");
    expect(statuses[0]).toMatchObject({ status: "is thinking…" });
    expect(statuses.at(-1)).toMatchObject({ status: "" });
  });

  it("falls back to one message when the event has no team id", async () => {
    const h = harness({
      sendPrompt: scripted([{ kind: "text", text: BIG }], "final answer"),
    });
    await h.mention({ teamId: undefined });
    await tick();

    const recs = h.records();
    expect(recs.some((r) => r.kind === "stream_start")).toBe(false);
    const msgs = recs.filter((r) => r.kind === "message");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ text: "final answer" });
  });

  it("falls back to one message when the agent streams nothing", async () => {
    const h = harness({ sendPrompt: scripted([], "quiet answer") });
    await h.mention();
    await tick();

    const recs = h.records();
    expect(recs.some((r) => r.kind === "stream_start")).toBe(false);
    expect(recs.filter((r) => r.kind === "message")).toHaveLength(1);
  });

  it("closes the stream and posts failure copy when the turn errors mid-stream", async () => {
    const h = harness({
      sendPrompt: async (_p, o) => {
        o.onUpdate?.({ kind: "text", text: BIG });
        throw new Error("boom");
      },
    });
    await h.mention();
    await tick();

    const recs = h.records();
    expect(recs.some((r) => r.kind === "stream_stop")).toBe(true);
    const msgs = recs.filter((r) => r.kind === "message");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ text: expect.stringContaining("Error:") });
    expect(recs.filter((r) => r.kind === "status").at(-1)).toMatchObject({
      status: "",
    });
    expect(h.turnEvents()[0]!.outcome).toBe("failure");
    expect(h.turnEvents()[0]!.reason).toBe("acp-error");
  });

  it("resume failure abandons the first stream, then streams the fresh reply", async () => {
    const FRESH = "y".repeat(400);
    let call = 0;
    const h = harness({
      listSessions: async () => [
        { sessionId: "s-1", platform: { threadTs: "1.1" } },
      ],
      sendPrompt: async (_p, o) => {
        call += 1;
        if (call === 1) {
          o.onUpdate?.({ kind: "text", text: BIG });
          throw new Error("resume failed");
        }
        o.onUpdate?.({ kind: "text", text: FRESH });
        return FRESH;
      },
    });
    await h.mention();
    await tick();

    const recs = h.records();
    const startIdxs = recs.flatMap((r, i) =>
      r.kind === "stream_start" ? [i] : [],
    );
    const stopIdxs = recs.flatMap((r, i) =>
      r.kind === "stream_stop" ? [i] : [],
    );
    // Two streams: the abandoned resume attempt, then the fresh one — with the
    // first stopped before the second opens (no interleaving).
    expect(startIdxs).toHaveLength(2);
    expect(stopIdxs[0]!).toBeLessThan(startIdxs[1]!);
    expect(recs.some((r) => r.kind === "message")).toBe(false);
    expect(h.turnEvents()[0]!.outcome).toBe("success");
  });

  it("never double-streams across a transient wake retry", async () => {
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
      sendPrompt: scripted([{ kind: "text", text: BIG }], BIG),
    });
    await h.mention();
    await tick();

    expect(ready).toBe(2);
    const recs = h.records();
    expect(recs.filter((r) => r.kind === "stream_start")).toHaveLength(1);
    expect(
      recs.some(
        (r) => r.kind === "message" && r.text.includes("still starting"),
      ),
    ).toBe(true);
  });
});

describe("slack live streaming — foreign fork turns", () => {
  it("streams the fork reply and clears status", async () => {
    const h = harness({
      isAllowedUser: true,
      linkedSub: "kc|member-2",
      forkSendPrompt: scripted([{ kind: "text", text: BIG }], BIG),
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
    expect(recs.filter((r) => r.kind === "stream_start")).toHaveLength(1);
    expect(recs.some((r) => r.kind === "stream_stop")).toBe(true);
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
