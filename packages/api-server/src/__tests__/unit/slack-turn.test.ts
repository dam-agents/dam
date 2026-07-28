import { describe, it, expect, vi } from "vitest";
import type { AgentsService } from "api-server-api";
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
  /** Currently-bound channel; a function so a test can rebind mid-turn. */
  boundChannel?: () => string;
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
      resolveSlackChannelByInstance: async () => opts.boundChannel?.() ?? "C1",
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

    // One post, still threaded — Slack fans it out to the channel itself, so
    // the agent never posts twice to be seen.
    const msgs = h.records().filter((r) => r.kind === "message");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({
      channel: "C1",
      threadTs: "7.7",
      text: "speaking order",
      replyBroadcast: true,
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

  it("describeMessageReactions defaults to the current turn's message", async () => {
    const h = harness({});
    await h.mention(); // sets the active turn (thread 1.1, message 1.1)
    await tick();
    h.gw.setMessageReactions("C1", "1.1", [
      { name: "thumbsup", count: 2, users: ["U1", "U2"] },
    ]);

    const result = await h.worker.describeMessageReactions("agent-1", {});
    expect(result).toEqual({
      reactions: [{ name: "thumbsup", count: 2, users: ["U1", "U2"] }],
      // Resolved and returned even though the query left both to default —
      // the caller (and its audit log) needs to know what actually got asked.
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

/** A harness whose turns park in `sendPrompt` until released or failed, so a
 *  test can hold several turns in flight for one agent at once — the situation
 *  that used to cross-route a reply into the wrong thread. Each turn records
 *  the thread it drives (its fresh-session `platformMeta.threadTs`). */
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
    /** Prompts started so far — tells a same-thread re-relay apart. */
    calls: () => gates.length,
    /** Fire a mention without awaiting — its turn parks in flight. */
    fire(ts: string, threadTs?: string) {
      void h.gw.fireMention({
        user: "U1",
        channel: "C1",
        ts,
        ...(threadTs !== undefined ? { threadTs } : {}),
        text: `msg ${ts}`,
        teamId: "T-e2e",
      });
    },
    async waitInFlight(...threads: string[]) {
      for (let i = 0; i < 200 && !threads.every((t) => started.has(t)); i++) {
        await tick();
      }
      expect(threads.every((t) => started.has(t))).toBe(true);
    },
    release() {
      for (const g of gates) g.release();
    },
    /** Fail the i-th started turn's prompt — the relay settles with an error
     *  while, in production, the pod-side harness would keep working. */
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
    h.fire("200.2");
    await h.waitInFlight("100.1", "200.2");

    // The reply carries no turn id, so which thread it belongs to is ambiguous
    // — refuse rather than guess (guessing is exactly the #2952 cross-route).
    const ambiguous = await h.worker.reply("agent-1", {
      text: "which thread?",
    });
    expect(ambiguous).toMatchObject({
      error: expect.stringContaining("more than one"),
    });
    expect(h.records().some((r) => r.kind === "message")).toBe(false);

    // The prompt-injected threadTs resolves it deterministically.
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
    h.fire("200.2");
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
    h.fire("200.2");
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
  // The runtime keeps a running prompt alive when its relay drops, so a turn
  // whose relay settles with a transport error may still be executing in the
  // pod — and its late id-less reply used to resolve against whatever turn was
  // live by then, posting one thread's answer into another.

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

    // The failed turn's harness may still be working thread 100.1; routing its
    // id-less reply to the sole *live* turn would post it into thread 200.2.
    const refused = await h.worker.reply("agent-1", { text: "late answer" });
    expect(refused).toMatchObject({
      error: expect.stringContaining("more than one"),
    });
    expect(h.records().some((r) => r.kind === "message")).toBe(false);

    // The prompt-injected id still resolves deterministically.
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

    // Thread 200.2 is the last active thread, but its turn finished cleanly —
    // the only work that can still be running is the failed turn's.
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

    // A new mention in the SAME thread: both candidates name thread 100.1, so
    // a reply is unambiguous — but they trigger from different messages, so an
    // id-less react could mark the wrong one.
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
    // The resume prompt may have reached the harness before the relay dropped
    // — the runtime keeps that run alive while the worker retries on a fresh
    // session. After the retry completes, the ghost run can still be working.
    const started = new Set<string>();
    const gates: Array<() => void> = [];
    const sendPrompt: SendPromptFn = async (_prompt, opts) => {
      if ("resumeSessionId" in opts) {
        throw new Error("ACP connection lost (agent unreachable)");
      }
      const meta = opts as { platformMeta?: { threadTs?: string } };
      const thread = meta.platformMeta?.threadTs ?? "unknown";
      started.add(thread);
      if (thread === "200.2") {
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
    for (let i = 0; i < 200 && !started.has("200.2"); i++) await tick();
    h.gw.resetOutbound();

    // The ghost run from the failed resume may still be driving thread 100.1;
    // an id-less reply must not resolve to the sole live turn's thread.
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
    // The second turn waits at the session lock instead of racing the
    // list-then-create session match into a duplicate session.
    expect(gates).toHaveLength(1);
    expect(sessions).toHaveLength(1);

    gates[0]!();
    for (let i = 0; i < 200 && gates.length < 2; i++) await tick();
    gates[1]!();
    await tick();

    expect(sessions).toHaveLength(1);
    expect(resumed).toEqual(["s-1"]);
  });

  it("serializes fork turns per thread session — forks share the agent's session store", async () => {
    const forkGates: Array<() => void> = [];
    let forkCalls = 0;
    const h = harness({
      isAllowedUser: true,
      linkedSub: "kc|member-2",
      forkSendPrompt: async () => {
        forkCalls++;
        await new Promise<void>((r) => forkGates.push(r));
        return "fork answer";
      },
    });
    await h.start();
    // Two foreign replies in the same thread, each provisioning a fork.
    await h.gw.fireMention({
      user: "U-S1",
      channel: "C1",
      ts: "1.1",
      text: "first foreign reply",
      teamId: "T-e2e",
    });
    await h.gw.fireMention({
      user: "U-S2",
      channel: "C1",
      ts: "1.2",
      threadTs: "1.1",
      text: "second foreign reply",
      teamId: "T-e2e",
    });
    const foreigns = h.events.filter(
      (e): e is ForeignReplyReceived =>
        e.type === EventType.ForeignReplyReceived,
    );
    expect(foreigns).toHaveLength(2);
    emitGlobal({
      type: EventType.ForkReady,
      forkId: "fork-1",
      replyId: foreigns[0]!.replyId,
      podIP: "10.0.0.5",
    });
    emitGlobal({
      type: EventType.ForkReady,
      forkId: "fork-2",
      replyId: foreigns[1]!.replyId,
      podIP: "10.0.0.6",
    });
    for (let i = 0; i < 20; i++) await tick();
    // Fork pods mount the same session store as the main pod, so the second
    // fork must wait for the first instead of racing the session match.
    expect(forkCalls).toBe(1);

    forkGates[0]!();
    for (let i = 0; i < 200 && forkCalls < 2; i++) await tick();
    expect(forkCalls).toBe(2);
    forkGates[1]!();
    await tick();
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

    // The owner rebinds the agent to another channel while the turn is live.
    // The turn's threadTs only means anything inside C1 — the reply must
    // follow the turn, not the binding.
    bound = "C2";
    h.gw.resetOutbound();
    const ok = await h.worker.reply("agent-1", { text: "for C1's thread" });
    expect(ok).toEqual({ ok: true });
    expect(h.records().filter((r) => r.kind === "message")[0]).toMatchObject({
      channel: "C1",
      threadTs: "100.1",
    });

    // An explicit id naming the live turn follows it into C1 the same way —
    // batch turns must pass ids, so the protection can't hinge on omission.
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

    // Rebound mid-turn: the turn's ts only resolves inside C1, so a lookup
    // that defaulted to the new binding would miss the message entirely.
    bound = "C2";
    expect(await h.worker.describeMessageReactions("agent-1", {})).toEqual({
      reactions: [{ name: "eyes", count: 1, users: ["U2"] }],
      conversationId: "C1",
      messageTs: "100.1",
    });

    // An explicit ts naming the live turn is back-filled to its channel too.
    expect(
      await h.worker.describeMessageReactions("agent-1", {
        messageTs: "100.1",
      }),
    ).toMatchObject({ conversationId: "C1" });

    for (const g of gates) g();
    await tick();
  });
});
