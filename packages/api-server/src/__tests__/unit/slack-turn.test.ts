import { createMemoryTtlStore } from "../../core/ttl-store.js";
import { configureLogger } from "../../core/logger.js";
import { describe, it, expect, vi } from "vitest";
import { slackThreadKey, type AgentsService } from "api-server-api";
import {
  createSlackWorker,
  TURN_LINGER_MS,
} from "../../modules/channels/infrastructure/slack.js";
import { createFakeSlackGateway } from "../../modules/channels/infrastructure/fake-slack-gateway.js";
import type {
  AcpClient,
  PromptUpdate,
  SendPromptOpts,
} from "../../core/acp-client.js";
import {
  EventType,
  type ChannelTurnRelayed,
  type DomainEvent,
} from "../../events.js";
import { AgentWakeTimeoutError } from "../../modules/agents/index.js";
import type { ChannelTurnAttendance } from "../../core/turn-attendance.js";
import { stubTurnAttendance } from "../helpers/turn-attendance.js";
import { stubWorkspaceFiles } from "../helpers/workspace-files.js";

const OWNER = "kc|owner-1";

type SendPromptFn = (
  prompt: string | Array<unknown>,
  opts: SendPromptOpts,
) => Promise<string>;

function scripted(updates: PromptUpdate[], response: string): SendPromptFn {
  return async (_prompt, opts) => {
    for (const u of updates) opts.onUpdate?.(u);
    return response;
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function harness(opts: {
  sendPrompt?: SendPromptFn;
  listSessions?: AcpClient["listSessions"];
  ensureReady?: AgentsService["ensureReady"];
  boundChannel?: () => string;
  attendance?: ChannelTurnAttendance;
  agentName?: string;
}) {
  const gw = createFakeSlackGateway();
  const events: DomainEvent[] = [];
  const acp: AcpClient = {
    steer: async () => "unsupported" as const,
    listSessions: opts.listSessions ?? (async () => []),
    sendPrompt: opts.sendPrompt ?? scripted([], "the answer"),
    triggerSession: () => Promise.reject(new Error("unused")),
  };
  const agents = {
    ensureReady: opts.ensureReady ?? (async () => {}),
    ...(opts.agentName !== undefined
      ? { get: async () => ({ name: opts.agentName }) }
      : {}),
  } as unknown as AgentsService;

  const worker = createSlackWorker(
    () => acp,
    () => gw,
    () => agents,
    { resolve: async () => OWNER } as never,
    { authUrl: "http://kc", clientId: "c" } as never,
    createMemoryTtlStore(600_000),
    async () => OWNER,
    {
      resolveSlackBindings: async () => [
        {
          instanceName: "agent-1",
          owner: OWNER,
          ambient: false,
          isDefault: true,
        },
      ],
      resolveSlackChannelsByInstance: async () => [
        opts.boundChannel?.() ?? "C1",
      ],
    } as never,
    async () => {},
    async () => {},
    async () => true,
    { name: "DAM", short: "dam" },
    async () => true,
    "http://ui",
    opts.attendance ?? stubTurnAttendance(),
    stubWorkspaceFiles(),
    (e) => events.push(e),
  );

  return {
    gw,
    events,
    worker,
    async start() {
      await worker.connect();
    },
    async mention(over?: { user?: string; teamId?: string; text?: string }) {
      await worker.connect();
      await gw.fireMention({
        user: over?.user ?? "U1",
        channel: "C1",
        ts: "1.1",
        text: over?.text ?? "hi agent",
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

describe("slack reply / react tools", () => {
  it("reply posts into the current turn's thread with the agent footer", async () => {
    const h = harness({});
    await h.mention();
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

  it("reply does not broadcast to the channel unless asked (#2973)", async () => {
    const h = harness({});
    await h.mention();
    await tick();
    h.gw.resetOutbound();

    await h.worker.reply("agent-1", { text: "thread only" });
    const msgs = h.records().filter((r) => r.kind === "message");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).not.toHaveProperty("replyBroadcast");
  });

  it("reply broadcasts to the channel as one threaded post when asked (#2973)", async () => {
    const h = harness({});
    await h.mention();
    await tick();
    h.gw.resetOutbound();

    const result = await h.worker.reply("agent-1", {
      text: "speaking order",
      threadTs: "7.7",
      alsoSendToChannel: true,
    });
    expect(result).toEqual({ ok: true });

    const msgs = h.records().filter((r) => r.kind === "message");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({
      channel: "C1",
      threadTs: "7.7",
      text: "speaking order",
      replyBroadcast: true,
    });
  });

  it("reply footers link at the session the turn ran on", async () => {
    const h = harness({
      sendPrompt: async (_prompt, opts) => {
        opts.onSession?.("sess-42");
        return "the answer";
      },
    });
    await h.mention();
    await tick();

    const posts = vi.spyOn(h.gw, "postMessage");
    await h.worker.reply("agent-1", { text: "here you go" });

    expect(posts).toHaveBeenCalledTimes(1);
    expect(posts.mock.calls[0]![0].blocks).toContainEqual({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "<http://ui/a/agent-1?s=sess-42|Powered by DAM>",
        },
      ],
    });
  });

  it("reply footers fall back to the agent when no session is known", async () => {
    const h = harness({});
    await h.mention();
    await tick();

    const posts = vi.spyOn(h.gw, "postMessage");
    await h.worker.reply("agent-1", { text: "here you go" });

    expect(posts.mock.calls[0]![0].blocks).toContainEqual({
      type: "context",
      elements: [
        { type: "mrkdwn", text: "<http://ui/a/agent-1|Powered by DAM>" },
      ],
    });
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

  it("describeMessageReactions defaults to the current turn's message", async () => {
    const h = harness({});
    await h.mention();
    await tick();
    h.gw.setMessageReactions("C1", "1.1", [
      { name: "thumbsup", count: 2, users: ["U1", "U2"] },
    ]);

    const result = await h.worker.describeMessageReactions("agent-1", {});
    expect(result).toEqual({
      reactions: [{ name: "thumbsup", count: 2, users: ["U1", "U2"] }],
      conversationId: "C1",
      messageTs: "1.1",
    });
  });

  it("describeMessageReactions errors when there is no active turn and no messageTs", async () => {
    const h = harness({});
    await h.start();

    const result = await h.worker.describeMessageReactions("agent-1", {});
    expect(result).toMatchObject({
      error: expect.stringContaining("pass messageTs"),
    });
  });
});

function gatedHarness() {
  const started = new Set<string>();
  const gates: Array<{ release: () => void; fail: (err: unknown) => void }> =
    [];
  const sendPrompt: SendPromptFn = async (_prompt, opts) => {
    const meta = opts as { platformMeta?: { threadTs?: string } };
    started.add(meta.platformMeta?.threadTs ?? "unknown");
    await new Promise<void>((resolve, reject) =>
      gates.push({ release: resolve, fail: reject }),
    );
    return "answer";
  };
  const h = harness({ sendPrompt });
  return {
    ...h,
    started,
    calls: () => gates.length,
    fire(ts: string, threadTs?: string, user = "U1") {
      void h.gw.fireMention({
        user,
        channel: "C1",
        ts,
        ...(threadTs !== undefined ? { threadTs } : {}),
        text: `msg ${ts}`,
        teamId: "T-e2e",
      });
    },
    async waitInFlight(...threads: string[]) {
      const keys = threads.map((t) => slackThreadKey("C1", t));
      for (let i = 0; i < 200 && !keys.every((k) => started.has(k)); i++) {
        await tick();
      }
      expect(keys.every((k) => started.has(k))).toBe(true);
    },
    release() {
      for (const g of gates) g.release();
    },
    fail(i: number, err: unknown) {
      gates[i]!.fail(err);
    },
    releaseAt(i: number) {
      gates[i]!.release();
    },
    async settled(done: () => boolean) {
      for (let i = 0; i < 200 && !done(); i++) {
        await tick();
      }
      expect(done()).toBe(true);
    },
  };
}

describe("slack reply / react tools — concurrent turns (#2952)", () => {
  it("refuses an id-less reply while two threads are in flight, and honours an explicit threadTs", async () => {
    const h = gatedHarness();
    await h.start();
    h.fire("100.1");
    h.fire("200.2", undefined, "U2");
    await h.waitInFlight("100.1", "200.2");

    const ambiguous = await h.worker.reply("agent-1", {
      text: "which thread?",
    });
    expect(ambiguous).toMatchObject({
      error: expect.stringContaining("more than one"),
    });
    expect(h.records().some((r) => r.kind === "message")).toBe(false);

    h.gw.resetOutbound();
    const ok = await h.worker.reply("agent-1", {
      text: "for thread A",
      threadTs: "100.1",
    });
    expect(ok).toEqual({ ok: true });
    const msgs = h.records().filter((r) => r.kind === "message");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ threadTs: "100.1", text: "for thread A" });

    h.release();
    await tick();
  });

  it("refuses an id-less react while two threads are in flight", async () => {
    const h = gatedHarness();
    await h.start();
    h.fire("100.1");
    h.fire("200.2", undefined, "U2");
    await h.waitInFlight("100.1", "200.2");

    const ambiguous = await h.worker.react("agent-1", { emoji: "eyes" });
    expect(ambiguous).toMatchObject({
      error: expect.stringContaining("more than one"),
    });
    expect(h.records().some((r) => r.kind === "reaction")).toBe(false);

    h.release();
    await tick();
  });

  it("resolves an id-less reply to the sole in-flight turn's thread", async () => {
    const h = gatedHarness();
    await h.start();
    h.fire("100.1");
    await h.waitInFlight("100.1");
    h.gw.resetOutbound();

    const ok = await h.worker.reply("agent-1", { text: "sole turn" });
    expect(ok).toEqual({ ok: true });
    const msgs = h.records().filter((r) => r.kind === "message");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ threadTs: "100.1" });

    h.release();
    await tick();
  });

  it("refuses an id-less describeMessageReactions while two threads are in flight", async () => {
    const h = gatedHarness();
    await h.start();
    h.fire("100.1");
    h.fire("200.2", undefined, "U2");
    await h.waitInFlight("100.1", "200.2");

    const ambiguous = await h.worker.describeMessageReactions("agent-1", {});
    expect(ambiguous).toMatchObject({
      error: expect.stringContaining("more than one"),
    });

    h.release();
    await tick();
  });
});

describe("slack reply / react tools — turns that outlive their relay", () => {
  it("refuses an id-less reply while a failed turn may still run and another thread is live", async () => {
    const h = gatedHarness();
    await h.start();
    h.fire("100.1");
    await h.waitInFlight("100.1");
    h.fail(0, new Error("ACP connection lost (agent unreachable)"));
    await h.settled(() => h.turnEvents().length === 1);

    h.fire("200.2");
    await h.waitInFlight("200.2");
    h.gw.resetOutbound();

    const refused = await h.worker.reply("agent-1", { text: "late answer" });
    expect(refused).toMatchObject({
      error: expect.stringContaining("more than one"),
    });
    expect(h.records().some((r) => r.kind === "message")).toBe(false);

    const ok = await h.worker.reply("agent-1", {
      text: "late answer",
      threadTs: "100.1",
    });
    expect(ok).toEqual({ ok: true });
    expect(h.records().filter((r) => r.kind === "message")[0]).toMatchObject({
      threadTs: "100.1",
    });

    h.release();
    await tick();
  });

  it("resolves an id-less reply to the failed turn once later turns finish — not to the last active thread", async () => {
    const h = gatedHarness();
    await h.start();
    h.fire("100.1");
    await h.waitInFlight("100.1");
    h.fail(0, new Error("ACP connection lost (agent unreachable)"));
    await h.settled(() => h.turnEvents().length === 1);

    h.fire("200.2");
    await h.waitInFlight("200.2");
    h.releaseAt(1);
    await h.settled(() => h.turnEvents().length === 2);
    h.gw.resetOutbound();

    const ok = await h.worker.reply("agent-1", { text: "late answer" });
    expect(ok).toEqual({ ok: true });
    const msgs = h.records().filter((r) => r.kind === "message");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ threadTs: "100.1" });
  });

  it("a successfully completed turn does not linger — the next sole live turn resolves", async () => {
    const h = gatedHarness();
    await h.start();
    h.fire("100.1");
    await h.waitInFlight("100.1");
    h.releaseAt(0);
    await h.settled(() => h.turnEvents().length === 1);

    h.fire("200.2");
    await h.waitInFlight("200.2");
    h.gw.resetOutbound();

    const ok = await h.worker.reply("agent-1", { text: "for the live turn" });
    expect(ok).toEqual({ ok: true });
    expect(h.records().filter((r) => r.kind === "message")[0]).toMatchObject({
      threadTs: "200.2",
    });

    h.release();
    await tick();
  });

  it("an expired lingering turn falls back to the last active thread", async () => {
    const h = gatedHarness();
    await h.start();
    h.fire("100.1");
    await h.waitInFlight("100.1");
    h.fail(0, new Error("ACP connection lost (agent unreachable)"));
    await h.settled(() => h.turnEvents().length === 1);

    h.fire("200.2");
    await h.waitInFlight("200.2");
    h.releaseAt(1);
    await h.settled(() => h.turnEvents().length === 2);
    h.gw.resetOutbound();

    const later = vi
      .spyOn(Date, "now")
      .mockReturnValue(new Date().getTime() + TURN_LINGER_MS + 1_000);
    try {
      const ok = await h.worker.reply("agent-1", { text: "proactive" });
      expect(ok).toEqual({ ok: true });
      expect(h.records().filter((r) => r.kind === "message")[0]).toMatchObject({
        threadTs: "200.2",
      });
    } finally {
      later.mockRestore();
    }
  });

  it("same-thread candidates resolve an id-less reply but refuse an id-less react", async () => {
    const h = gatedHarness();
    await h.start();
    h.fire("100.1");
    await h.waitInFlight("100.1");
    h.fail(0, new Error("ACP connection lost (agent unreachable)"));
    await h.settled(() => h.turnEvents().length === 1);

    h.fire("100.2", "100.1");
    await h.settled(() => h.calls() === 2);
    h.gw.resetOutbound();

    const ok = await h.worker.reply("agent-1", { text: "same thread" });
    expect(ok).toEqual({ ok: true });
    expect(h.records().filter((r) => r.kind === "message")[0]).toMatchObject({
      threadTs: "100.1",
    });

    const refused = await h.worker.react("agent-1", { emoji: "eyes" });
    expect(refused).toMatchObject({
      error: expect.stringContaining("more than one"),
    });

    h.release();
    await tick();
  });

  it("a resume attempt that fails mid-turn keeps its turn resolvable after the fallback succeeds", async () => {
    const started = new Set<string>();
    const gates: Array<() => void> = [];
    const sendPrompt: SendPromptFn = async (_prompt, opts) => {
      if ("resumeSessionId" in opts) {
        throw new Error("ACP connection lost (agent unreachable)");
      }
      const meta = opts as { platformMeta?: { threadTs?: string } };
      const thread = meta.platformMeta?.threadTs ?? "unknown";
      started.add(thread);
      if (thread === slackThreadKey("C1", "200.2")) {
        await new Promise<void>((resolve) => gates.push(resolve));
      }
      return "answer";
    };
    const h = harness({
      sendPrompt,
      listSessions: async () => [
        { sessionId: "s-1", platform: { threadTs: "100.1" } },
      ],
    });
    await h.start();
    await h.gw.fireMention({
      user: "U1",
      channel: "C1",
      ts: "100.1",
      text: "resumed turn",
      teamId: "T-e2e",
    });
    await tick();
    expect(h.turnEvents()[0]!.outcome).toBe("success");

    void h.gw.fireMention({
      user: "U1",
      channel: "C1",
      ts: "200.2",
      text: "new thread",
      teamId: "T-e2e",
    });
    const thread2 = slackThreadKey("C1", "200.2");
    for (let i = 0; i < 200 && !started.has(thread2); i++) await tick();
    h.gw.resetOutbound();

    const refused = await h.worker.reply("agent-1", { text: "late" });
    expect(refused).toMatchObject({
      error: expect.stringContaining("more than one"),
    });

    for (const g of gates) g();
    await tick();
  });

  it("two rapid first messages in a new thread mint one session — the second resumes it", async () => {
    const sessions: Array<{
      sessionId: string;
      platform: { threadTs?: string };
    }> = [];
    const resumed: string[] = [];
    const gates: Array<() => void> = [];
    const sendPrompt: SendPromptFn = async (_p, opts) => {
      if ("resumeSessionId" in opts) {
        resumed.push(opts.resumeSessionId);
      } else {
        const meta = opts as { platformMeta?: { threadTs?: string } };
        sessions.push({
          sessionId: `s-${sessions.length + 1}`,
          platform: { threadTs: meta.platformMeta?.threadTs },
        });
      }
      await new Promise<void>((r) => gates.push(r));
      return "answer";
    };
    const h = harness({ sendPrompt, listSessions: async () => sessions });
    await h.start();
    void h.gw.fireMention({
      user: "U1",
      channel: "C1",
      ts: "100.1",
      text: "first",
      teamId: "T-e2e",
    });
    void h.gw.fireMention({
      user: "U2",
      channel: "C1",
      ts: "100.2",
      threadTs: "100.1",
      text: "second",
      teamId: "T-e2e",
    });
    for (let i = 0; i < 200 && gates.length === 0; i++) await tick();
    for (let i = 0; i < 20; i++) await tick();
    expect(gates).toHaveLength(1);
    expect(sessions).toHaveLength(1);

    gates[0]!();
    for (let i = 0; i < 200 && gates.length < 2; i++) await tick();
    gates[1]!();
    await tick();

    expect(sessions).toHaveLength(1);
    expect(resumed).toEqual(["s-1"]);
  });

  it("an id-less reply resolved from a turn posts into that turn's channel, not the newly bound one", async () => {
    let bound = "C1";
    const gates: Array<() => void> = [];
    const h = harness({
      sendPrompt: async () => {
        await new Promise<void>((resolve) => gates.push(resolve));
        return "answer";
      },
      boundChannel: () => bound,
    });
    h.gw.setChannels([{ id: "C1", name: "general", botIsMember: true }]);
    await h.start();
    void h.gw.fireMention({
      user: "U1",
      channel: "C1",
      ts: "100.1",
      text: "question",
      teamId: "T-e2e",
    });
    for (let i = 0; i < 200 && gates.length === 0; i++) await tick();
    expect(gates.length).toBe(1);

    bound = "C2";
    h.gw.resetOutbound();
    const ok = await h.worker.reply("agent-1", { text: "for C1's thread" });
    expect(ok).toEqual({ ok: true });
    expect(h.records().filter((r) => r.kind === "message")[0]).toMatchObject({
      channel: "C1",
      threadTs: "100.1",
    });

    h.gw.resetOutbound();
    const okExplicit = await h.worker.reply("agent-1", {
      text: "explicit id",
      threadTs: "100.1",
    });
    expect(okExplicit).toEqual({ ok: true });
    expect(h.records().filter((r) => r.kind === "message")[0]).toMatchObject({
      channel: "C1",
      threadTs: "100.1",
    });

    for (const g of gates) g();
    await tick();
  });

  it("describeMessageReactions inspects the turn's channel, not the newly bound one", async () => {
    let bound = "C1";
    const gates: Array<() => void> = [];
    const h = harness({
      sendPrompt: async () => {
        await new Promise<void>((resolve) => gates.push(resolve));
        return "answer";
      },
      boundChannel: () => bound,
    });
    h.gw.setChannels([{ id: "C1", name: "general", botIsMember: true }]);
    h.gw.setMessageReactions("C1", "100.1", [
      { name: "eyes", count: 1, users: ["U2"] },
    ]);
    await h.start();
    void h.gw.fireMention({
      user: "U1",
      channel: "C1",
      ts: "100.1",
      text: "question",
      teamId: "T-e2e",
    });
    for (let i = 0; i < 200 && gates.length === 0; i++) await tick();
    expect(gates.length).toBe(1);

    bound = "C2";
    expect(await h.worker.describeMessageReactions("agent-1", {})).toEqual({
      reactions: [{ name: "eyes", count: 1, users: ["U2"] }],
      conversationId: "C1",
      messageTs: "100.1",
    });

    expect(
      await h.worker.describeMessageReactions("agent-1", {
        messageTs: "100.1",
      }),
    ).toMatchObject({ conversationId: "C1" });

    for (const g of gates) g();
    await tick();
  });
});

describe("slack turn — network-access framing and attendance", () => {
  function recordingAttendance() {
    const calls: string[] = [];
    let open = 0;
    return {
      calls,
      isOpen: () => open > 0,
      attendance: {
        openChannelTurn(agentId: string) {
          calls.push(`open:${agentId}`);
          open++;
          let released = false;
          return () => {
            if (released) return;
            released = true;
            calls.push(`release:${agentId}`);
            open--;
          };
        },
      } satisfies ChannelTurnAttendance,
    };
  }

  it("tells the agent an unallowed host can't be approved from the conversation", async () => {
    let prompt = "";
    const h = harness({
      sendPrompt: async (p) => {
        prompt = typeof p === "string" ? p : JSON.stringify(p);
        return "ok";
      },
    });
    await h.mention();
    await tick();

    expect(prompt).toContain("<network-access>");
    expect(prompt).toContain("cannot be approved from this conversation");
    expect(prompt).toContain("only your owner can allow a host, in DAM");
    expect(prompt).toContain("don't retry the same host in a loop");
  });

  it("scopes the reply contract to the message it arrives with", async () => {
    let prompt = "";
    const h = harness({
      sendPrompt: async (p) => {
        prompt = typeof p === "string" ? p : JSON.stringify(p);
        return "ok";
      },
    });
    await h.mention();
    await tick();

    expect(prompt).toContain(
      "apply to the message they arrive with, not to this conversation",
    );
    expect(prompt).toContain("a later message carries its own");
    expect(prompt).toContain("didn't come from Slack");
    expect(prompt).toContain("post to Slack for it only if you're asked to");
  });

  it("names the bot's own Slack id, so a tag of it reads as self", async () => {
    let prompt = "";
    const h = harness({
      sendPrompt: async (p) => {
        prompt = typeof p === "string" ? p : JSON.stringify(p);
        return "ok";
      },
    });
    h.gw.setBotUserId("U-BOT");
    await h.mention({ text: "<@U-BOT> say hi" });
    await tick();

    expect(prompt).toContain(
      'the bot "DAM" (mentioned as @dam, Slack user id U-BOT)',
    );
    expect(prompt).toContain("by tagging the bot (U-BOT in the text)");
    expect(prompt).toContain("the name your posts are signed with");
    expect(prompt).toContain("People address you two ways");
    expect(prompt).not.toContain('by typing "dam" with no tag');
    expect(prompt).toContain("only a tag reaches you");
    expect(prompt).toContain(
      "a post from it is yours only if the conversation history marks that " +
        'line "you (this agent)"',
    );
    expect(prompt).toContain("<addressed-to-you>");
    expect(prompt).toContain("You were @-mentioned");
    expect(prompt).toContain("the mention of U-BOT in it is you");
    expect(prompt).not.toContain("<reading-along>");
  });

  /**
   * TEST_SCENARIO: The api-server publishes this name in every footer, so it is
   * the name people type. A workspace persona may go by another, so leaving the
   * agent to infer "the name you know yourself by" misses the published one.
   */
  it("delivers the name the agent's posts are signed with, and makes it the authorship test", async () => {
    let prompt = "";
    const h = harness({
      agentName: "Buginator",
      sendPrompt: async (p) => {
        prompt = typeof p === "string" ? p : JSON.stringify(p);
        return "ok";
      },
    });
    h.gw.setBotUserId("U-BOT");
    await h.mention({ text: "Buginator can you look at this" });
    await tick();

    expect(prompt).toContain(
      'by the name your posts here are signed with, "Buginator"',
    );
    expect(prompt).toContain("any other name you know yourself by");
    expect(prompt).toContain(
      'yours only if the conversation history marks that line "you (this agent)"',
    );
    expect(prompt).not.toContain("agent-1");
  });

  it("omits the signed name rather than leaking the instance id when it can't be resolved", async () => {
    let prompt = "";
    const h = harness({
      sendPrompt: async (p) => {
        prompt = typeof p === "string" ? p : JSON.stringify(p);
        return "ok";
      },
    });
    await h.mention();
    await tick();

    expect(prompt).toContain(
      "the name your posts are signed with, the one you know yourself by",
    );
    expect(prompt).toContain(
      'the conversation history marks that line "you (this agent)"',
    );
    expect(prompt).not.toContain("agent-1");
  });

  it("still frames the turn as addressed when Slack won't say who the bot is", async () => {
    let prompt = "";
    const h = harness({
      sendPrompt: async (p) => {
        prompt = typeof p === "string" ? p : JSON.stringify(p);
        return "ok";
      },
    });
    h.gw.setBotUserId(null);
    await h.mention();
    await tick();

    expect(prompt).toContain('the bot "DAM" (mentioned as @dam).');
    expect(prompt).toContain("<addressed-to-you>");
    expect(prompt).toContain(
      "You were @-mentioned: this message is addressed to you.",
    );
    expect(prompt).not.toContain("Slack user id");
  });

  it("warns when an addressed turn ends without a reply or a reaction", async () => {
    const lines: string[] = [];
    configureLogger({ level: "warn", write: (line) => lines.push(line) });

    const h = harness({ sendPrompt: async () => "prose, never delivered" });
    await h.mention();
    await tick();

    const unanswered = lines
      .map((l) => JSON.parse(l))
      .filter((r) => String(r.msg).startsWith("slack.turn.unanswered"));
    configureLogger({ level: "info" });
    expect(unanswered).toHaveLength(1);
    expect(unanswered[0]).toMatchObject({
      agentId: "agent-1",
      channelId: "C1",
      threadTs: "1.1",
    });
  });

  it("stays quiet when the agent answers the turn", async () => {
    const lines: string[] = [];
    configureLogger({ level: "warn", write: (line) => lines.push(line) });

    const h = harness({
      sendPrompt: async () => {
        await h.worker.reply("agent-1", { text: "answered" });
        return "ok";
      },
    });
    await h.mention();
    await tick();
    configureLogger({ level: "info" });

    expect(
      lines.filter((l) => l.includes("slack.turn.unanswered")),
    ).toHaveLength(0);
  });

  /**
   * TEST_SCENARIO: no_reply_needed is the contract's own sanctioned way to end a
   * turn, so it must not read as the silence bug. It only can if the tool
   * reaches the worker — as a pure MCP no-op it left a decline and a failure
   * byte-identical.
   */
  it("does not warn when the agent deliberately declines the turn", async () => {
    const lines: string[] = [];
    configureLogger({ level: "info", write: (line) => lines.push(line) });

    const h = harness({
      sendPrompt: async () => {
        await h.worker.declineTurn("agent-1");
        return "ok";
      },
    });
    await h.mention();
    await tick();
    configureLogger({ level: "info" });

    const msgs = lines.map((l) => String(JSON.parse(l).msg));
    expect(msgs.some((m) => m.startsWith("slack.turn.unanswered"))).toBe(false);
    expect(msgs.some((m) => m.startsWith("slack.turn.declined"))).toBe(true);
  });

  /**
   * TEST_SCENARIO: an agent may answer with a top-level post rather than a
   * threaded reply. That reaches the channel, so the turn was answered.
   */
  it("stays quiet when the agent answers with a top-level post", async () => {
    const lines: string[] = [];
    configureLogger({ level: "warn", write: (line) => lines.push(line) });

    const h = harness({
      sendPrompt: async () => {
        await h.worker.postMessage("agent-1", "answered up top");
        return "ok";
      },
    });
    await h.mention();
    await tick();
    configureLogger({ level: "info" });

    expect(
      lines.filter((l) => l.includes("slack.turn.unanswered")),
    ).toHaveLength(0);
  });

  it("marks the agent channel-driven for the turn and releases it after", async () => {
    const rec = recordingAttendance();
    let openDuringTurn = false;
    const h = harness({
      attendance: rec.attendance,
      sendPrompt: async () => {
        openDuringTurn = rec.isOpen();
        return "ok";
      },
    });
    await h.mention();
    await tick();

    expect(openDuringTurn).toBe(true);
    expect(rec.calls).toEqual(["open:agent-1", "release:agent-1"]);
    expect(rec.isOpen()).toBe(false);
  });

  it("releases the marker when the turn fails to wake the agent", async () => {
    const rec = recordingAttendance();
    const h = harness({
      attendance: rec.attendance,
      ensureReady: async () => {
        throw new AgentWakeTimeoutError({
          agentId: "agent-1",
          timeoutMs: 120_000,
          durationMs: 120_100,
          failure: { kind: "agent-pod-not-ready" },
        });
      },
    });
    await h.mention();
    await tick();

    expect(rec.isOpen()).toBe(false);
    expect(rec.calls).toContain("release:agent-1");
  });
});
