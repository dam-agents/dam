/**
 * TEST_OVERVIEW: Posts by bots reach Agents the way a person's posts do. All
 * Agents post through the one bot, so an Agent's post is told apart by its
 * Agent Footer, and it never starts a turn for the Agent that wrote it. Posts
 * by other apps and incoming webhooks reach the Agents too, unless the channel
 * ignores that app with `/dam ignore <link to one of its posts>`. A run of bot
 * posts in one conversation
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
import type {
  SlackIgnoredApp,
  SlackIgnoredApps,
} from "../../modules/channels/infrastructure/slack-ignored-apps-repository.js";
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

type BindingOpts = { ambient?: boolean };

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
    ignored?: SlackIgnoredApp[];
    replies?: Partial<Record<string, (nth: number) => string | null>>;
    sends?: Partial<Record<string, (nth: number) => string | null>>;
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
  const ignored: SlackIgnoredApp[] = [...(opts.ignored ?? [])];
  const ignoredApps: SlackIgnoredApps = {
    list: async () => [...ignored],
    ignore: async (_channel, app) => {
      if (ignored.some((entry) => entry.botId === app.botId)) return false;
      ignored.push(app);
      return true;
    },
    unignore: async (_channel, botId) => {
      const at = ignored.findIndex((entry) => entry.botId === botId);
      if (at < 0) return false;
      ignored.splice(at, 1);
      return true;
    },
  };
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
      const sent = opts.sends?.[agentId]?.(prompts[agentId]!.length);
      if (sent)
        await worker.postMessage(agentId, sent, { conversationId: "C1" });
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
    ignoredApps,
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
    ignored,
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

  /** TEST_SCENARIO: During its ambient turn an Agent also posts with
   *  send_channel_message. That tool does not say which session calls it, so
   *  the post is not marked as a round reply, and it reaches the other
   *  reader as a new post. */
  it("lets a send_channel_message post reach the other readers", async () => {
    const h = harness({
      a: { ambient: true },
      b: { ambient: true },
      sends: { "agent-a": once("deploy started") },
    });
    await h.message(person, "ship it", { ts: "7.1" });
    expect(h.prompts["agent-a"]).toHaveLength(1);
    expect(h.prompts["agent-b"]).toHaveLength(2);
    expect(h.prompts["agent-b"]![1]).toContain("deploy started");
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

  /** TEST_SCENARIO: The channel ignores FluxCD. Its posts reach no Agent
   *  there, neither plain nor tagged, while another app still gets through. */
  it("reaches no agent once the channel ignores the app", async () => {
    const h = harness({
      a: { ambient: true },
      b: { ambient: true },
      ignored: [{ botId: "B-FLUX", name: "FluxCD" }],
    });
    await h.message(fromFlux, "Reconciliation failed");
    await h.mention(fromFlux, "<@UBOT> Beta, look at this", "3.3");
    expect(h.prompts["agent-a"]).toHaveLength(0);
    expect(h.prompts["agent-b"]).toHaveLength(0);

    await h.message(
      { kind: "app", botId: "B-CI", name: "CI" },
      "build failed",
      { ts: "4.4" },
    );
    expect(h.prompts["agent-a"]).toHaveLength(1);
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

const FLUX_POST_TS = "1700000000.123456";
const FLUX_LINK = "https://acme.slack.com/archives/C1/p1700000000123456";

describe("/dam ignore and /dam unignore", () => {
  function withPost(h: ReturnType<typeof harness>, post: object) {
    h.gw.setMessage("C1", { ts: FLUX_POST_TS, text: "status", ...post });
  }

  /** TEST_SCENARIO: Someone who owns an Agent here points at one of FluxCD's
   *  posts. The app that wrote it is added to the channel's ignore list. */
  it("ignores the app that wrote the linked post", async () => {
    const h = harness({ linkedSub: OWNER });
    withPost(h, { botId: "B-FLUX", botName: "FluxCD" });
    const reply = await h.command(`ignore ${FLUX_LINK}`);
    expect(h.ignored).toEqual([{ botId: "B-FLUX", name: "FluxCD" }]);
    expect(reply).toContain("now ignore posts from `FluxCD`");
  });

  /** TEST_SCENARIO: Only apps and webhooks can be ignored. A link to an
   *  Agent's post or a person's post is refused and changes nothing. */
  it.each([
    [
      "an agent's post",
      {
        botId: "B-SELF",
        user: "U-BOT",
        blocks: [
          {
            type: "context",
            elements: [{ type: "mrkdwn", text: "<http://ui/a/agent-a|Alpha>" }],
          },
        ],
      },
      "That is an agent's post",
    ],
    ["a person's post", { user: "U1" }, "from a person"],
  ])("refuses a link to %s", async (_what, post, expected) => {
    const h = harness({ linkedSub: OWNER });
    withPost(h, post);
    const reply = await h.command(`ignore ${FLUX_LINK}`);
    expect(h.ignored).toEqual([]);
    expect(reply).toContain(expected);
  });

  /** TEST_SCENARIO: Changing the list needs a linked account, and that
   *  account must have connected or own an Agent connected here. */
  it.each([
    [null, "Link your account first"],
    ["kc|stranger", "Only someone who connected an agent here"],
  ])("refuses %s", async (linkedSub, expected) => {
    const h = harness({ linkedSub });
    withPost(h, { botId: "B-FLUX", botName: "FluxCD" });
    const reply = await h.command(`ignore ${FLUX_LINK}`);
    expect(h.ignored).toEqual([]);
    expect(reply).toContain(expected);
  });

  it("lists the ignored apps when given no link", async () => {
    const h = harness({ ignored: [{ botId: "B-FLUX", name: "FluxCD" }] });
    expect(await h.command("ignore")).toContain("ignore posts from `FluxCD`");
  });

  /** TEST_SCENARIO: An ignored app is named back by the name it was stored
   *  with, in any case, and the agents hear it again. */
  it("unignores an app by name", async () => {
    const h = harness({
      linkedSub: OWNER,
      ignored: [{ botId: "B-FLUX", name: "FluxCD" }],
    });
    const reply = await h.command("unignore fluxcd");
    expect(h.ignored).toEqual([]);
    expect(reply).toContain("hear `FluxCD` again");
  });

  it("names the ignored apps when the name matches none", async () => {
    const h = harness({
      linkedSub: OWNER,
      ignored: [{ botId: "B-FLUX", name: "FluxCD" }],
    });
    const reply = await h.command("unignore Jenkins");
    expect(h.ignored).toHaveLength(1);
    expect(reply).toContain("No ignored app here is called `Jenkins`");
  });
});
