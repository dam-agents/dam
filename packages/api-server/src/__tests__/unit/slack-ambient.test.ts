import { createMemoryTtlStore } from "../../core/ttl-store.js";
import { describe, it, expect, beforeEach } from "vitest";
import { slackThreadKey, type AgentsService } from "api-server-api";
import type { ContentBlock } from "@agentclientprotocol/sdk/dist/schema/types.gen.js";
import { createSlackWorker } from "../../modules/channels/infrastructure/slack.js";
import { createFakeSlackGateway } from "../../modules/channels/infrastructure/fake-slack-gateway.js";
import { stubTurnAttendance } from "../helpers/turn-attendance.js";
import { stubWorkspaceFiles } from "../helpers/workspace-files.js";
import type { AcpClient, SendPromptOpts } from "../../core/acp-client.js";
import { configureLogger } from "../../core/logger.js";
import {
  EventType,
  type ChannelTurnRelayed,
  type DomainEvent,
} from "../../events.js";
import { AgentWakeTimeoutError } from "../../modules/agents/index.js";
import type { StoredChannelConfig } from "../../modules/channels/stored-channel.js";

const OWNER = "kc|owner-1";
const STRANGER = "U-STRANGER";

const logLines: string[] = [];
configureLogger({ level: "info", write: (l) => logLines.push(l) });
beforeEach(() => {
  logLines.length = 0;
});

type Binding = {
  instanceName: string;
  owner: string;
  ambient?: boolean;
} | null;

function harness(opts: {
  binding: Binding;
  resolveBinding?: () => Promise<Binding>;
  linkedSub?: string | null;
  termsAccepted?: (sub: string) => boolean;
  respond?: (prompt: string | ContentBlock[]) => Promise<string> | string;
  ensureReady?: AgentsService["ensureReady"];
}) {
  const gw = createFakeSlackGateway();
  const events: DomainEvent[] = [];
  const prompts: Array<string | ContentBlock[]> = [];
  const sendOpts: SendPromptOpts[] = [];
  const ambientCalls: Array<{ channelId: string; ambient: boolean }> = [];
  const acp: AcpClient = {
    listSessions: async () => [],
    sendPrompt: async (prompt, o) => {
      prompts.push(prompt);
      sendOpts.push(o);
      return opts.respond ? await opts.respond(prompt) : "the answer";
    },
    triggerSession: () => Promise.reject(new Error("unused")),
  };
  const agents = {
    ensureReady: opts.ensureReady ?? (async () => {}),
  } as unknown as AgentsService;

  const worker = createSlackWorker(
    () => acp,
    () => gw,
    () => agents,
    { resolve: async () => opts.linkedSub ?? null } as never,
    { authUrl: "http://kc", clientId: "c" } as never,
    createMemoryTtlStore(600_000),
    async () => OWNER,
    {
      resolveSlackBinding: opts.resolveBinding ?? (async () => opts.binding),
      resolveSlackChannelsByInstance: async () => ["C1"],
    } as never,
    async () => {},
    async (channelId, ambient) => {
      ambientCalls.push({ channelId, ambient });
    },
    { name: "DAM", short: "dam" },
    async (sub) => opts.termsAccepted?.(sub) ?? true,
    "http://ui",
    stubTurnAttendance(),
    stubWorkspaceFiles(),
    (e) => events.push(e),
  );

  const start = () => worker.start("agent-1", {} as StoredChannelConfig);

  return {
    gw,
    events,
    prompts,
    sendOpts,
    ambientCalls,
    worker,
    async message(
      user: string,
      text: string,
      extra?: { ts?: string; threadTs?: string },
    ) {
      await start();
      await gw.fireMessage({
        user,
        channel: "C1",
        ts: extra?.ts ?? "1.1",
        threadTs: extra?.threadTs,
        text,
      });
    },
    async mention(user: string) {
      await start();
      await gw.fireMention({
        user,
        channel: "C1",
        ts: "1.1",
        text: "hi agent",
      });
    },
    async command(text: string, userId = STRANGER) {
      await start();
      return gw.fireCommand({ text, userId, channelId: "C1" });
    },
    async settled(done: () => boolean) {
      for (let i = 0; i < 100 && !done(); i++) {
        await new Promise((r) => setTimeout(r, 0));
      }
      expect(done()).toBe(true);
    },
    messages: () => gw.readOutbound().filter((r) => r.kind === "message"),
    reactions: () => gw.readOutbound().filter((r) => r.kind === "reaction"),
    texts: () => gw.readOutbound().map((r) => ("text" in r ? r.text : "")),
    turnEvents: () =>
      events.filter(
        (e): e is ChannelTurnRelayed => e.type === EventType.ChannelTurnRelayed,
      ),
    securityRecords: () =>
      logLines.map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

const ambient: Binding = {
  instanceName: "agent-1",
  owner: OWNER,
  ambient: true,
};
const mentionsOnly: Binding = {
  instanceName: "agent-1",
  owner: OWNER,
};

function wakeError(
  failure: AgentWakeTimeoutError["failure"],
): AgentWakeTimeoutError {
  return new AgentWakeTimeoutError({
    agentId: "agent-1",
    timeoutMs: 120_000,
    durationMs: 120_100,
    failure,
  });
}

describe("slack ambient inbound", () => {
  it("ambient off (default): a plain channel message is dropped silently", async () => {
    const h = harness({ binding: mentionsOnly });
    await h.message(STRANGER, "does anyone know why the build fails?");
    await new Promise((r) => setTimeout(r, 0));

    expect(h.prompts).toHaveLength(0);
    expect(h.gw.readOutbound()).toHaveLength(0);
    expect(h.turnEvents()).toHaveLength(0);
  });

  it("ambient on: relays with the read-along frame and the tool contract, posting nothing itself", async () => {
    const h = harness({ binding: ambient });
    await h.message(STRANGER, "what is our deploy process?", { ts: "7.7" });
    await h.settled(() => h.turnEvents().length === 1);

    expect(h.prompts).toHaveLength(1);
    const prompt = String(h.prompts[0]);
    expect(prompt).toContain("<reading-along>");
    expect(prompt).toContain("<how-to-respond>");
    expect(prompt).toContain("no_reply_needed");
    expect(prompt).toContain(`<@${STRANGER}>: what is our deploy process?`);
    expect(prompt).toContain('the bot "DAM"');
    expect(prompt).toContain("@dam");
    expect(prompt).toContain("answer it as you would a mention");
    expect(prompt).toContain("open with a fitting emoji reaction");
    expect(prompt).not.toContain("agent-1");

    expect(h.gw.readOutbound()).toHaveLength(0);
  });

  it("ambient on: a reply during the turn threads under the triggering message", async () => {
    const pending: Array<(v: string) => void> = [];
    const h = harness({
      binding: ambient,
      respond: () => new Promise<string>((r) => pending.push(r)),
    });
    await h.message(STRANGER, "what is our deploy process?", { ts: "7.7" });
    await h.settled(() => pending.length === 1);

    const result = await h.worker.reply("agent-1", {
      text: "here's the runbook",
    });
    expect(result).toEqual({ ok: true });
    expect(h.messages()[0]).toMatchObject({
      channel: "C1",
      threadTs: "7.7",
      text: "here's the runbook",
    });

    pending[0]!("");
    await h.settled(() => h.turnEvents().length === 1);
  });

  it("ambient on: a silent read-along turn does not repoint the proactive reply fallback", async () => {
    const h = harness({ binding: ambient });
    await h.message(STRANGER, "random chatter nobody asked about", {
      ts: "7.7",
    });
    await h.settled(() => h.turnEvents().length === 1);

    const result = await h.worker.reply("agent-1", { text: "follow-up" });
    expect(result).toMatchObject({
      error: expect.stringContaining("no active thread"),
    });
    expect(h.messages()).toHaveLength(0);
  });

  it("ambient on: keys top-level flow to the channel's rolling ambient session", async () => {
    const h = harness({ binding: ambient });
    await h.message(STRANGER, "hello there");
    await h.settled(() => h.sendOpts.length === 1);

    const opts = h.sendOpts[0]!;
    expect("platformMeta" in opts && opts.platformMeta?.threadTs).toBe(
      "ambient:C1",
    );
  });

  it("ambient on: a thread reply keeps the thread's own session key and reply target", async () => {
    const pending: Array<(v: string) => void> = [];
    const h = harness({
      binding: ambient,
      respond: () => new Promise<string>((r) => pending.push(r)),
    });
    await h.message(STRANGER, "sure, in this thread", {
      ts: "5.2",
      threadTs: "5.1",
    });
    await h.settled(() => pending.length === 1);

    expect(h.sendOpts).toHaveLength(1);
    const opts = h.sendOpts[0]!;
    expect("platformMeta" in opts && opts.platformMeta?.threadTs).toBe(
      slackThreadKey("C1", "5.1"),
    );
    await h.worker.reply("agent-1", { text: "here" });
    expect(h.messages()[0]).toMatchObject({ threadTs: "5.1" });

    pending[0]!("");
    await h.settled(() => h.turnEvents().length === 1);
  });

  it("ambient on: the turn response is never auto-posted — posting is the agent's tool call", async () => {
    const h = harness({
      binding: ambient,
      respond: () => "I could answer this, but I'll wait to be asked.",
    });
    await h.message(STRANGER, "lunch anyone?");
    await h.settled(() => h.turnEvents().length === 1);

    expect(h.prompts).toHaveLength(1);
    expect(h.gw.readOutbound()).toHaveLength(0);
    expect(h.turnEvents()[0]!.outcome).toBe("success");
  });

  it("ambient on: an empty turn posts nothing and still counts as success", async () => {
    const h = harness({ binding: ambient, respond: () => "" });
    await h.message(STRANGER, "lunch anyone?");
    await h.settled(() => h.turnEvents().length === 1);

    expect(h.gw.readOutbound()).toHaveLength(0);
    expect(h.turnEvents()[0]!.outcome).toBe("success");
  });

  it("ambient on: attributes the turn by Slack id, never a platform sub", async () => {
    const h = harness({ binding: ambient });
    await h.message(STRANGER, "what time is standup?");
    await h.settled(() => h.turnEvents().length === 1);

    const turn = h.turnEvents()[0]!;
    expect(turn.actorSub).toBe(null);
    expect(turn.externalActorId).toBe(STRANGER);
    expect(turn.outcome).toBe("success");
  });

  it("ambient on: logs a basis:'place' allow with trigger:'ambient'", async () => {
    const h = harness({ binding: ambient });
    await h.message(STRANGER, "what time is standup?");
    await h.settled(() => h.turnEvents().length === 1);

    const allows = h
      .securityRecords()
      .filter((r) => r.msg === "channel.authz" && r.decision === "allow");
    expect(allows).toHaveLength(1);
    expect(allows[0]!.detail).toMatchObject({
      basis: "place",
      trigger: "ambient",
      slackUserId: STRANGER,
      channelId: "C1",
    });
  });

  it("ambient on: owner ToU not accepted — skips silently, no ephemeral ping", async () => {
    const h = harness({
      binding: ambient,
      termsAccepted: (sub) => sub !== OWNER,
    });
    await h.message(STRANGER, "does anyone know the wifi password?");
    await new Promise((r) => setTimeout(r, 0));

    expect(h.prompts).toHaveLength(0);
    expect(h.gw.readOutbound()).toHaveLength(0);
    expect(h.turnEvents()).toHaveLength(0);
  });

  it("ambient on: a failed turn is logged and evented, never posted to the channel", async () => {
    const h = harness({
      binding: ambient,
      respond: () => Promise.reject(new Error("boom")),
    });
    await h.message(STRANGER, "what broke?");
    await h.settled(() => h.turnEvents().length === 1);

    expect(h.gw.readOutbound()).toHaveLength(0);
    const turn = h.turnEvents()[0]!;
    expect(turn.outcome).toBe("failure");
    expect(turn.reason).toBe("acp-error");
  });

  it("ambient on: a transient wake overrun retries silently — no still-starting post", async () => {
    let calls = 0;
    const h = harness({
      binding: ambient,
      ensureReady: async () => {
        calls += 1;
        if (calls === 1) throw wakeError({ kind: "agent-pod-not-ready" });
      },
    });
    await h.message(STRANGER, "how do I rotate the token?");
    await h.settled(() => h.turnEvents().length === 1);

    expect(calls).toBe(2);
    expect(h.turnEvents()[0]!.outcome).toBe("success");
    expect(h.gw.readOutbound()).toHaveLength(0);
  });

  it("coalesces messages that arrive while a turn is in flight into one prompt", async () => {
    const pending: Array<(v: string) => void> = [];
    const h = harness({
      binding: ambient,
      respond: () => new Promise<string>((r) => pending.push(r)),
    });

    await h.message("U-A", "one", { ts: "1.1" });
    await h.settled(() => pending.length === 1);
    await h.message("U-B", "two", { ts: "2.2" });
    await h.message("U-C", "three", { ts: "3.3" });

    pending[0]!("");
    await h.settled(() => pending.length === 2);

    expect(h.prompts).toHaveLength(2);
    const batched = String(h.prompts[1]);
    expect(batched).toContain("[ts 2.2] <@U-B>: two");
    expect(batched).toContain("[ts 3.3] <@U-C>: three");

    expect(batched).toContain("You're reading 2 messages from");
    expect(batched).not.toContain("You're answering a message sent");
    expect(batched).not.toContain("permalink");
    expect(String(h.prompts[0])).toContain("You're answering a message sent");

    const refused = await h.worker.reply("agent-1", { text: "on it" });
    expect(refused).toMatchObject({
      error: expect.stringContaining("more than one"),
    });
    const ok = await h.worker.reply("agent-1", {
      text: "answering two",
      threadTs: "2.2",
    });
    expect(ok).toEqual({ ok: true });
    expect(h.messages()[0]).toMatchObject({
      threadTs: "2.2",
      text: "answering two",
    });

    pending[1]!("on it");
    await h.settled(() => h.turnEvents().length === 2);
  });

  it("coalesces thread read-along messages that arrive while a turn is in flight into one prompt", async () => {
    const pending: Array<(v: string) => void> = [];
    const h = harness({
      binding: ambient,
      respond: () => new Promise<string>((r) => pending.push(r)),
    });

    await h.message("U-A", "one", { ts: "1.1", threadTs: "T.0" });
    await h.settled(() => pending.length === 1);
    await h.message("U-B", "two", { ts: "2.2", threadTs: "T.0" });
    await h.message("U-C", "three", { ts: "3.3", threadTs: "T.0" });

    pending[0]!("");
    await h.settled(() => pending.length === 2);

    expect(h.prompts).toHaveLength(2);
    const batched = String(h.prompts[1]);
    expect(batched).toContain("[ts 2.2] <@U-B>: two");
    expect(batched).toContain("[ts 3.3] <@U-C>: three");

    for (const o of h.sendOpts) {
      expect("platformMeta" in o && o.platformMeta?.threadTs).toBe(
        slackThreadKey("C1", "T.0"),
      );
    }

    await h.worker.reply("agent-1", { text: "on it" });
    expect(h.messages()[0]).toMatchObject({ threadTs: "T.0", text: "on it" });

    pending[1]!("on it");
    await h.settled(() => h.turnEvents().length === 2);

    const reacted = await h.worker.react("agent-1", { emoji: "eyes" });
    expect(reacted).toEqual({ ok: true });
    expect(h.reactions()[0]).toMatchObject({ ts: "3.3" });
  });

  it("serializes a mention behind an in-flight ambient turn on the same thread session", async () => {
    const pending: Array<(v: string) => void> = [];
    const h = harness({
      binding: ambient,
      respond: () => new Promise<string>((r) => pending.push(r)),
    });
    await h.message("U-A", "reading along", { ts: "1.1", threadTs: "T.1" });
    await h.settled(() => pending.length === 1);

    void h.gw.fireMention({
      user: "U-B",
      channel: "C1",
      ts: "2.2",
      threadTs: "T.1",
      text: "hey bot",
    });
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
    expect(h.prompts).toHaveLength(1);

    pending[0]!("");
    await h.settled(() => pending.length === 2);
    pending[1]!("answer");
    await h.settled(() => h.turnEvents().length === 2);
  });

  it("an engaged ambient turn becomes the proactive reply fallback", async () => {
    const pending: Array<(v: string) => void> = [];
    const h = harness({
      binding: ambient,
      respond: () => new Promise<string>((r) => pending.push(r)),
    });
    await h.message("U-A", "can someone check the build?", { ts: "9.9" });
    await h.settled(() => pending.length === 1);

    await h.worker.reply("agent-1", { text: "on it" });
    pending[0]!("");
    await h.settled(() => h.turnEvents().length === 1);
    h.gw.resetOutbound();

    const ok = await h.worker.reply("agent-1", { text: "build is green" });
    expect(ok).toEqual({ ok: true });
    expect(h.messages()[0]).toMatchObject({ threadTs: "9.9" });
  });

  it("keeps a relay-failed thread turn resolvable — an id-less reply is never cross-routed into another thread", async () => {
    const pending: Array<{
      resolve: (v: string) => void;
      reject: (err: unknown) => void;
    }> = [];
    const h = harness({
      binding: ambient,
      respond: () =>
        new Promise<string>((resolve, reject) =>
          pending.push({ resolve, reject }),
        ),
    });

    await h.message("U-A", "in thread one", { ts: "1.1", threadTs: "T.1" });
    await h.settled(() => pending.length === 1);
    pending[0]!.reject(new Error("ACP connection lost (agent unreachable)"));
    await h.settled(() => h.turnEvents().length === 1);
    expect(h.turnEvents()[0]!.outcome).toBe("failure");

    await h.message("U-B", "in thread two", { ts: "2.1", threadTs: "T.2" });
    await h.settled(() => pending.length === 2);

    const refused = await h.worker.reply("agent-1", { text: "late answer" });
    expect(refused).toMatchObject({
      error: expect.stringContaining("more than one"),
    });
    expect(h.messages()).toHaveLength(0);

    const ok = await h.worker.reply("agent-1", {
      text: "late answer",
      threadTs: "T.1",
    });
    expect(ok).toEqual({ ok: true });
    expect(h.messages()[0]).toMatchObject({ threadTs: "T.1" });

    pending[1]!.resolve("");
    await h.settled(() => h.turnEvents().length === 2);
  });

  it("drains separate threads on independent queues — one busy thread never blocks another", async () => {
    const pending: Array<(v: string) => void> = [];
    const h = harness({
      binding: ambient,
      respond: () => new Promise<string>((r) => pending.push(r)),
    });

    await h.message("U-A", "in thread one", { ts: "1.1", threadTs: "T.1" });
    await h.message("U-B", "in thread two", { ts: "2.1", threadTs: "T.2" });

    await h.settled(() => pending.length === 2);
    expect(h.prompts).toHaveLength(2);
    expect(
      h.sendOpts.map((o) => "platformMeta" in o && o.platformMeta?.threadTs),
    ).toEqual([slackThreadKey("C1", "T.1"), slackThreadKey("C1", "T.2")]);

    pending.forEach((r) => r(""));
    await h.settled(() => h.turnEvents().length === 2);
  });

  it("re-checks the owner's ToU at drain time — a queued batch never relays past a stale gate", async () => {
    let ownerAccepted = true;
    const pending: Array<(v: string) => void> = [];
    const h = harness({
      binding: ambient,
      termsAccepted: (sub) => (sub === OWNER ? ownerAccepted : true),
      respond: () => new Promise<string>((r) => pending.push(r)),
    });

    await h.message("U-A", "one", { ts: "1.1" });
    await h.settled(() => pending.length === 1);
    await h.message("U-B", "two", { ts: "2.2" });
    ownerAccepted = false;
    pending[0]!("");
    await h.settled(() => h.turnEvents().length === 1);

    expect(h.prompts).toHaveLength(1);
    expect(h.gw.readOutbound()).toHaveLength(0);
  });

  it("a drain-time failure resolving the binding is swallowed, not an unhandled rejection", async () => {
    let resolveCalls = 0;
    const h = harness({
      binding: ambient,
      resolveBinding: async () => {
        resolveCalls += 1;
        if (resolveCalls > 1) throw new Error("db reset");
        return ambient;
      },
    });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      await h.message(STRANGER, "hello");
      await h.settled(() => resolveCalls === 2);
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }

    expect(unhandled).toEqual([]);
    expect(h.prompts).toHaveLength(0);
    expect(h.gw.readOutbound()).toHaveLength(0);
    const drainFailures = logLines.filter((l) =>
      l.includes("slack.ambient_drain.failed"),
    );
    expect(drainFailures).toHaveLength(1);
  });

  it("mentions in an ambient channel keep the addressed-turn treatment", async () => {
    const h = harness({ binding: ambient });
    await h.mention(STRANGER);

    expect(h.prompts).toHaveLength(1);
    expect(String(h.prompts[0])).not.toContain("<reading-along>");
    expect(String(h.prompts[0])).toContain("<how-to-respond>");
    expect(h.reactions()).toHaveLength(0);
    expect(h.messages()).toHaveLength(0);
  });
});

describe("slack ambient command", () => {
  it("reports the current state on bare 'ambient'", async () => {
    const off = harness({ binding: mentionsOnly });
    expect(await off.command("ambient")).toContain("off");

    const on = harness({ binding: ambient });
    expect(await on.command("ambient")).toContain("on —");
  });

  it("refuses on an unbound channel", async () => {
    const h = harness({ binding: null });
    expect(await h.command("ambient on")).toContain(
      "isn't connected to an agent",
    );
    expect(h.ambientCalls).toHaveLength(0);
  });

  it("refuses an unlinked invoker", async () => {
    const h = harness({ binding: mentionsOnly, linkedSub: null });
    expect(await h.command("ambient on")).toContain("/dam login");
    expect(h.ambientCalls).toHaveLength(0);
  });

  it("refuses a linked user who is neither binder nor agent owner", async () => {
    const h = harness({ binding: mentionsOnly, linkedSub: "kc|member-2" });
    expect(await h.command("ambient on")).toContain(
      "Only the person who connected this channel",
    );
    expect(h.ambientCalls).toHaveLength(0);
  });

  it("lets the binder turn ambient on: persists, confirms to the invoker only, audits", async () => {
    const h = harness({ binding: mentionsOnly, linkedSub: OWNER });
    const ack = await h.command("ambient on");

    expect(ack).toContain("turned on");
    expect(ack).toContain("reads along");
    expect(ack).toContain("/dam ambient off");
    expect(h.ambientCalls).toEqual([{ channelId: "C1", ambient: true }]);
    expect(h.messages()).toHaveLength(0);

    const toggles = h
      .securityRecords()
      .filter((r) => r.msg === "channel.ambient_toggled");
    expect(toggles).toHaveLength(1);
    expect(toggles[0]!.detail).toMatchObject({ ambient: true });
  });

  it("lets the binder turn ambient off, confirming to the invoker only", async () => {
    const h = harness({ binding: ambient, linkedSub: OWNER });
    const ack = await h.command("ambient off");

    expect(ack).toContain("turned off");
    expect(ack).toContain("only responds when mentioned");
    expect(h.ambientCalls).toEqual([{ channelId: "C1", ambient: false }]);
    expect(h.messages()).toHaveLength(0);
  });

  it("is a no-op when the state already matches", async () => {
    const h = harness({ binding: ambient, linkedSub: OWNER });
    expect(await h.command("ambient on")).toContain("already on");
    expect(h.ambientCalls).toHaveLength(0);
    expect(h.messages()).toHaveLength(0);
  });

  it("warns the invoker when enabling while the owner's ToU is pending", async () => {
    const h = harness({
      binding: mentionsOnly,
      linkedSub: OWNER,
      termsAccepted: (sub) => sub !== OWNER,
    });
    const ack = await h.command("ambient on");
    expect(ack).toContain("turned on");
    expect(ack).toContain("Terms of Use");
  });
});
