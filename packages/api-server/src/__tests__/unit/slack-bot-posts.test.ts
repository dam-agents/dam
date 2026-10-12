/**
 * TEST_OVERVIEW: Posts by bots reach Agents the way a person's posts do. All
 * Agents post through the one bot, so an Agent's post is told apart by its
 * Agent Footer, and it never starts a turn for the Agent that wrote it. Posts
 * by other apps and incoming webhooks reach every binding that has not opted
 * out with `/dam apps <agent> off`. A run of bot posts in one conversation
 * starts turns only up to a limit, until a person posts there again. Bot
 * senders get no private notices, because a notice needs a person.
 */
import { createMemoryTtlStore } from "../../core/ttl-store.js";
import { beforeEach, describe, expect, it } from "vitest";
import type { AgentsService } from "api-server-api";
import { createSlackWorker } from "../../modules/channels/infrastructure/slack.js";
import { createFakeSlackGateway } from "../../modules/channels/infrastructure/fake-slack-gateway.js";
import {
  classifySlackSender,
  type SlackSender,
} from "../../modules/channels/infrastructure/slack-sender.js";
import { stubTurnAttendance } from "../helpers/turn-attendance.js";
import { stubWorkspaceFiles } from "../helpers/workspace-files.js";
import type { AcpClient } from "../../core/acp-client.js";
import { configureLogger } from "../../core/logger.js";

const OWNER = "kc|owner-1";
const NAMES: Record<string, string> = { "agent-a": "Alpha", "agent-b": "Beta" };

const logLines: string[] = [];
configureLogger({ level: "info", write: (l) => logLines.push(l) });
beforeEach(() => {
  logLines.length = 0;
});

type BindingOpts = { ambient?: boolean; ignoreApps?: boolean };

const fromAlpha: SlackSender = {
  kind: "agent",
  agentId: "agent-a",
  ambientRound: false,
};
const fromFlux: SlackSender = { kind: "app", botId: "B-FLUX", name: "FluxCD" };

function harness(
  opts: {
    a?: BindingOpts;
    b?: BindingOpts;
    noDefault?: boolean;
    linkedSub?: string | null;
    replies?: Partial<Record<string, (nth: number) => string | null>>;
    replyThread?: string;
  } = {},
) {
  const fake = createFakeSlackGateway();
  let echoed = 0;
  const echo = (args: Parameters<typeof fake.postMessage>[0]) => {
    const sender = classifySlackSender(
      { user: "U-BOT", blocks: args.blocks },
      { userId: "U-BOT", botId: null },
    );
    if (!sender) return;
    const event = {
      sender,
      channel: args.channel,
      channelType: "channel",
      ts: `50.${++echoed}`,
      threadTs: args.threadTs,
      text: args.text,
    };
    void (args.text.includes("<@U-BOT>")
      ? fake.fireMention(event)
      : fake.fireMessage(event));
  };
  const gw: typeof fake = {
    ...fake,
    async postMessage(args) {
      const posted = await fake.postMessage(args);
      setTimeout(() => echo(args), 0);
      return posted;
    },
  };
  const prompts: Record<string, string[]> = { "agent-a": [], "agent-b": [] };
  const ignoreAppsCalls: Array<[string, string, boolean]> = [];
  const acpFor = (agentId: string): AcpClient => ({
    steer: async () => "unsupported" as const,
    listSessions: async () => [],
    sendPrompt: async (prompt, o) => {
      o.onSession?.(`sess-${agentId}`);
      if (String(JSON.stringify(prompt)).includes("<turn-undelivered>"))
        return "nudged";
      prompts[agentId]!.push(JSON.stringify(prompt));
      const said = opts.replies?.[agentId]?.(prompts[agentId]!.length);
      if (said)
        await worker.reply(agentId, { text: said, threadTs: opts.replyThread });
      return "";
    },
    triggerSession: () => Promise.reject(new Error("unused")),
    turnStatus: async () => "unknown" as const,
  });
  const agents = {
    ensureReady: async () => {},
    get: async (id: string) => (NAMES[id] ? { id, name: NAMES[id] } : null),
  } as unknown as AgentsService;
  const binding = (instanceName: string, b: BindingOpts | undefined) => ({
    instanceName,
    owner: OWNER,
    teamId: "",
    ambient: b?.ambient === true,
    ignoreApps: b?.ignoreApps === true,
    isDefault: instanceName === "agent-a" && !opts.noDefault,
  });

  const worker = createSlackWorker({
    makeAcpClient: (id) => acpFor(id),
    createGateway: () => gw,
    agents: () => agents,
    identityLinks: { resolve: async () => opts.linkedSub ?? null } as never,
    oauthConfig: { authUrl: "http://kc", clientId: "c" } as never,
    pendingOAuthFlows: createMemoryTtlStore(600_000),
    getInstanceOwner: async () => OWNER,
    channelRegistry: {
      resolveSlackBindings: async () => [
        binding("agent-a", opts.a),
        binding("agent-b", opts.b),
      ],
      resolveSlackChannelsByInstance: async () => [{ id: "C1", teamId: "" }],
    } as never,
    unbindSlackChannel: async () => {},
    setSlackChannelAmbient: async () => {},
    setSlackChannelIgnoreApps: async (agentId, channelId, ignoreApps) => {
      ignoreAppsCalls.push([agentId, channelId, ignoreApps]);
    },
    setSlackDefault: async () => true,
    brand: { name: "DAM", short: "dam" },
    isTermsAccepted: async () => true,
    uiBaseUrl: "http://ui",
    attendance: stubTurnAttendance(),
    workspaceFiles: stubWorkspaceFiles(),
    listWorkspaces: async () => [],
    emit: () => {},
    settleMs: 0,
    wakeWait: { patienceMs: 60_000, sleep: async () => {} },
  });

  async function settle() {
    for (let i = 0; i < 200; i++) await new Promise((r) => setTimeout(r, 0));
  }

  return {
    gw,
    prompts,
    ignoreAppsCalls,
    async mention(sender: SlackSender, text: string, ts = "1.1") {
      await worker.connect();
      await gw.fireMention({ sender, channel: "C1", ts, text });
      await settle();
    },
    async message(
      sender: SlackSender,
      text: string,
      extra: { ts?: string; threadTs?: string } = {},
    ) {
      await worker.connect();
      await gw.fireMessage({
        sender,
        ...(sender.kind === "person" ? { user: sender.user } : {}),
        channel: "C1",
        channelType: "channel",
        ts: extra.ts ?? "1.1",
        threadTs: extra.threadTs,
        text,
      });
      await settle();
    },
    async directMessage(sender: SlackSender, text: string) {
      await worker.connect();
      await gw.fireDirectMessage({
        sender,
        channel: "D1",
        channelType: "im",
        ts: "1.1",
        text,
      });
      await settle();
    },
    async command(text: string) {
      await worker.connect();
      return gw.fireCommand({ text, userId: "U-OWNER", channelId: "C1" });
    },
    ephemerals: () => gw.readOutbound().filter((r) => r.kind === "ephemeral"),
    loopBoundHits: () =>
      logLines.filter((l) => l.includes("slack.bot_post.loop_bound")).length,
  };
}

describe("an agent's post addressing another agent", () => {
  /** TEST_SCENARIO: Agent A tags the bot and names Beta. Beta gets a turn
   *  without any person posting, and the prompt names Alpha as the speaker
   *  instead of the shared bot's user id. */
  it("starts a turn for the agent it names", async () => {
    const h = harness();
    await h.mention(fromAlpha, "<@UBOT> Beta, can you check the deploy?");
    expect(h.prompts["agent-b"]).toHaveLength(1);
    expect(h.prompts["agent-b"]![0]).toContain("Alpha (another agent):");
    expect(h.prompts["agent-a"]).toHaveLength(0);
  });

  /** TEST_SCENARIO: An unnamed tag falls back to the default Agent. When that
   *  default wrote the post itself, nobody gets a turn: an Agent is never
   *  triggered by its own post. */
  it("never starts a turn for the agent that wrote it", async () => {
    const h = harness();
    await h.mention(fromAlpha, "<@UBOT> done, the deploy is green");
    expect(h.prompts["agent-a"]).toHaveLength(0);
    expect(h.prompts["agent-b"]).toHaveLength(0);
  });

  /** TEST_SCENARIO: A bot post that tags the bot can reach the worker twice,
   *  as a mention and again as a forwarded plain message. It must start one
   *  turn only. */
  it("starts one turn when the same post arrives twice", async () => {
    const h = harness();
    await h.mention(fromAlpha, "<@UBOT> Beta, over to you", "2.2");
    await h.mention(fromAlpha, "<@UBOT> Beta, over to you", "2.2");
    expect(h.prompts["agent-b"]).toHaveLength(1);
  });

  /** TEST_SCENARIO: Both Agents read along. Alpha's post reaches Beta, and
   *  not Alpha. */
  it("reaches other ambient readers but not the author", async () => {
    const h = harness({ a: { ambient: true }, b: { ambient: true } });
    await h.message(fromAlpha, "I restarted the job");
    expect(h.prompts["agent-a"]).toHaveLength(0);
    expect(h.prompts["agent-b"]).toHaveLength(1);
  });
});

describe("an agent's reply in an ambient round", () => {
  const person: SlackSender = { kind: "person", user: "U1" };
  const once = (text: string) => (nth: number) => (nth === 1 ? text : null);

  /** TEST_SCENARIO: A person asks in a thread where both Agents read along,
   *  and both reply. The round already handed the earlier reply to the later
   *  reader, so a reply that Slack sends back starts no further turn. */
  it("starts no second turn in a thread", async () => {
    const h = harness({
      a: { ambient: true },
      b: { ambient: true },
      replyThread: "9.0",
      replies: { "agent-a": once("fixed it"), "agent-b": once("confirmed") },
    });
    await h.message(person, "the job is red", { ts: "9.1", threadTs: "9.0" });
    expect(h.prompts["agent-a"]).toHaveLength(1);
    expect(h.prompts["agent-b"]).toHaveLength(1);
  });

  /** TEST_SCENARIO: A person posts at the top level and the replies go into
   *  the thread under that post, a different queue from the round's. They
   *  must not start turns there either. */
  it("starts no turn in the thread under a top-level post", async () => {
    const h = harness({
      a: { ambient: true },
      b: { ambient: true },
      replyThread: "7.1",
      replies: { "agent-a": once("fixed it"), "agent-b": once("confirmed") },
    });
    await h.message(person, "the job is red", { ts: "7.1" });
    expect(h.prompts["agent-a"]).toHaveLength(1);
    expect(h.prompts["agent-b"]).toHaveLength(1);
  });

  it.each([
    ["at the top level", "7.1", undefined],
    ["in a thread", "9.0", "9.0"],
  ])(
    "hands a peer's tagged request to that peer once, %s",
    async (_where, replyThread, threadTs) => {
      /** TEST_SCENARIO: Alpha goes first in the round and tags Beta. Beta
       *  takes the request as an addressed turn and skips its ambient turn in
       *  the round, so it answers once. Beta's answer is not a reply in the
       *  round, so it reaches Alpha, which asked for it. */
      const h = harness({
        a: { ambient: true },
        b: { ambient: true },
        replyThread,
        replies: {
          "agent-a": once("<@U-BOT> Beta, can you rerun the job?"),
          "agent-b": once("rerun done, it is green"),
        },
      });
      await h.message(person, "the job is red", {
        ts: threadTs ? "9.1" : "7.1",
        threadTs,
      });
      expect(h.prompts["agent-b"]).toHaveLength(1);
      expect(h.prompts["agent-b"]![0]).toContain("Alpha (another agent):");
      expect(h.prompts["agent-a"]).toHaveLength(2);
      expect(h.prompts["agent-a"]![1]).toContain("rerun done");
    },
  );
});

describe("a post by another app or webhook", () => {
  /** TEST_SCENARIO: FluxCD posts in a channel where both Agents read along.
   *  Both get the post the way they get a person's post, labelled with the
   *  app's name. */
  it("reaches ambient readers, labelled with the app name", async () => {
    const h = harness({ a: { ambient: true }, b: { ambient: true } });
    await h.message(fromFlux, "Reconciliation failed for kustomization apps");
    expect(h.prompts["agent-a"]).toHaveLength(1);
    expect(h.prompts["agent-b"]).toHaveLength(1);
    expect(h.prompts["agent-a"]![0]).toContain("FluxCD (an app):");
  });

  /** TEST_SCENARIO: Beta's binding ignores apps. The FluxCD post reaches
   *  Alpha only. */
  it("skips a binding that ignores apps", async () => {
    const h = harness({
      a: { ambient: true },
      b: { ambient: true, ignoreApps: true },
    });
    await h.message(fromFlux, "Reconciliation failed");
    expect(h.prompts["agent-a"]).toHaveLength(1);
    expect(h.prompts["agent-b"]).toHaveLength(0);
  });

  /** TEST_SCENARIO: An app tags the bot in a channel with no default Agent and
   *  names nobody. A person would get a private notice explaining why; an app
   *  cannot receive one, so nothing is posted. */
  it("gets no private notice when it reaches nobody", async () => {
    const h = harness({ noDefault: true });
    await h.mention(fromFlux, "<@UBOT> deploy finished");
    expect(h.ephemerals()).toHaveLength(0);
    expect(h.prompts["agent-a"]).toHaveLength(0);
  });

  /** TEST_SCENARIO: A direct message is a conversation with one person. A bot
   *  post there, including an Agent's own reply, starts no turn. */
  it("starts no turn in a direct message", async () => {
    const h = harness();
    await h.directMessage(fromFlux, "hello");
    await h.directMessage(fromAlpha, "hello");
    expect(h.prompts["agent-a"]).toHaveLength(0);
    expect(h.prompts["agent-b"]).toHaveLength(0);
  });
});

describe("the loop bound", () => {
  /** TEST_SCENARIO: Bot posts keep arriving in one thread with no person
   *  posting. The first three are admitted, the fourth is dropped. A person's
   *  post resets the count, so the next bot post is admitted again. */
  it("stops bot posts after the limit until a person posts", async () => {
    const h = harness({ a: { ambient: true } });
    for (const ts of ["9.1", "9.2", "9.3", "9.4"])
      await h.message(fromFlux, "status", { ts, threadTs: "9.0" });
    expect(h.loopBoundHits()).toBe(1);

    await h.message({ kind: "person", user: "U1" }, "thanks", {
      ts: "9.5",
      threadTs: "9.0",
    });
    await h.message(fromFlux, "status", { ts: "9.6", threadTs: "9.0" });
    expect(h.loopBoundHits()).toBe(1);
  });

  /** TEST_SCENARIO: The count is per conversation. Bot posts filling one
   *  thread do not stop bot posts in another. */
  it("counts each thread on its own", async () => {
    const h = harness({ a: { ambient: true } });
    for (const ts of ["9.1", "9.2", "9.3"])
      await h.message(fromFlux, "status", { ts, threadTs: "9.0" });
    await h.message(fromFlux, "status", { ts: "8.1", threadTs: "8.0" });
    expect(h.loopBoundHits()).toBe(0);
  });
});

describe("/dam apps", () => {
  /** TEST_SCENARIO: The owner turns app posts off for Beta. The switch is
   *  stored as ignoreApps on Beta's binding in this channel. */
  it("stores ignoreApps on the named binding", async () => {
    const h = harness({ linkedSub: OWNER });
    const reply = await h.command("apps Beta off");
    expect(h.ignoreAppsCalls).toEqual([["agent-b", "C1", true]]);
    expect(reply).toContain("now ignores posts from other apps");
  });

  /** TEST_SCENARIO: Changing the switch needs a linked account, like ambient
   *  mode. */
  it("asks an unlinked user to link first", async () => {
    const h = harness({ linkedSub: null });
    const reply = await h.command("apps Beta off");
    expect(h.ignoreAppsCalls).toEqual([]);
    expect(reply).toContain("Link your account first");
  });

  /** TEST_SCENARIO: Without on or off the command reports the current
   *  setting. */
  it("reports the current setting", async () => {
    const h = harness({ b: { ignoreApps: true } });
    const reply = await h.command("apps Beta");
    expect(reply).toContain("are ignored by `Beta`");
  });
});
