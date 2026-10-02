import { createMemoryTtlStore } from "../../core/ttl-store.js";
import { describe, it, expect, beforeEach } from "vitest";
import type { AgentsService } from "api-server-api";
import {
  createSlackWorker,
  type SlackWorker,
} from "../../modules/channels/infrastructure/slack.js";
import { createFakeSlackGateway } from "../../modules/channels/infrastructure/fake-slack-gateway.js";
import { parseWhisperRequest } from "../../modules/channels/infrastructure/slack-routing.js";
import { stubTurnAttendance } from "../helpers/turn-attendance.js";
import { stubWorkspaceFiles } from "../helpers/workspace-files.js";
import type { AcpClient, SendPromptOpts } from "../../core/acp-client.js";
import { configureLogger } from "../../core/logger.js";

/**
 * TEST_OVERVIEW: `/dam whisper` gives anyone in a conversation a private line
 * to one of its agents. With a quoted message it is one turn whose answer
 * reaches the whisperer alone as an ephemeral; with no message it opens a
 * thread in the whisperer's DM with the bot that stays routed to that agent,
 * whatever the DM itself is bound to, for as long as the agent stays connected
 * where the whisper started and the whisperer stays a member there.
 */

const OWNER = "kc|owner-1";
const CHANNEL = "C-TEAM";
const USER = "U-WHISPERER";
const DM = `D-${USER}`;
const SCRIBE = "agent-scribe";
const REVIEWER = "agent-reviewer";

const logLines: string[] = [];
configureLogger({ level: "info", write: (l) => logLines.push(l) });
beforeEach(() => {
  logLines.length = 0;
});

interface Spec {
  instanceName: string;
  name: string;
  isDefault?: boolean;
}

function harness(
  bindings: Record<string, Spec[]>,
  hooks: {
    onPrompt?: (instanceName: string, worker: SlackWorker) => Promise<void>;
    failPrompt?: boolean;
  } = {},
) {
  const gw = createFakeSlackGateway();
  const posted: Array<{ channel: string; ts: string }> = [];
  const post = gw.postMessage.bind(gw);
  gw.postMessage = async (args) => {
    const result = await post(args);
    if (result) posted.push({ channel: args.channel, ts: result.ts });
    return result;
  };
  gw.setChannels([
    { id: CHANNEL, name: "team", botIsMember: true, members: [USER] },
  ]);
  const prompts: Array<{ agent: string; text: string; key?: string }> = [];
  const names = new Map(
    Object.values(bindings)
      .flat()
      .map((spec) => [spec.instanceName, spec.name]),
  );

  const makeAcp = (instanceName: string): AcpClient => ({
    steer: async () => "unsupported" as const,
    listSessions: async () => [],
    sendPrompt: async (prompt: unknown, opts: SendPromptOpts) => {
      prompts.push({
        agent: instanceName,
        text: typeof prompt === "string" ? prompt : JSON.stringify(prompt),
        ...("platformMeta" in opts && opts.platformMeta?.threadTs
          ? { key: opts.platformMeta.threadTs }
          : {}),
      });
      if (hooks.failPrompt) throw new Error("boom");
      await hooks.onPrompt?.(instanceName, worker);
      return "answer";
    },
    triggerSession: () => Promise.reject(new Error("unused")),
    turnStatus: async () => "unknown" as const,
  });

  const agents = {
    ensureReady: async () => {},
    get: async (id: string) =>
      names.has(id) ? { id, name: names.get(id) } : null,
  } as unknown as AgentsService;

  const worker: SlackWorker = createSlackWorker({
    makeAcpClient: makeAcp,
    createGateway: () => gw,
    agents: () => agents,
    identityLinks: { resolve: async () => null } as never,
    oauthConfig: { authUrl: "http://kc", clientId: "c" } as never,
    pendingOAuthFlows: createMemoryTtlStore(600_000),
    getInstanceOwner: async () => OWNER,
    channelRegistry: {
      resolveSlackBindings: async (channel: string) =>
        (bindings[channel] ?? []).map((spec) => ({
          instanceName: spec.instanceName,
          owner: OWNER,
          teamId: "",
          ambient: false,
          isDefault: spec.isDefault === true,
        })),
      resolveSlackChannelsByInstance: async (agentId: string) =>
        Object.entries(bindings)
          .filter(([, specs]) => specs.some((s) => s.instanceName === agentId))
          .map(([id]) => ({ id, teamId: "" })),
    } as never,
    unbindSlackChannel: async () => {},
    setSlackChannelAmbient: async () => {},
    setSlackDefault: async () => true,
    brand: { name: "DAM", short: "dam" },
    isTermsAccepted: async () => true,
    uiBaseUrl: "http://ui",
    attendance: stubTurnAttendance(),
    workspaceFiles: stubWorkspaceFiles(),
    listWorkspaces: async () => [],
    emit: () => {},
  });

  return {
    gw,
    worker,
    prompts,
    async command(text: string, channelId = CHANNEL) {
      await worker.connect();
      return gw.fireCommand({ text, userId: USER, channelId });
    },
    async replyInDm(threadTs: string, text: string, ts = "2000.000001") {
      await gw.fireDirectMessage({
        user: USER,
        channel: DM,
        ts,
        threadTs,
        text,
        channelType: "im",
      });
    },
    postedTo: (channel: string) =>
      posted.filter((p) => p.channel === channel).map((p) => p.ts),
    outbound: () => gw.readOutbound(),
    security: () =>
      logLines.map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

const team: Record<string, Spec[]> = {
  [CHANNEL]: [
    { instanceName: SCRIBE, name: "Scribe", isDefault: true },
    { instanceName: REVIEWER, name: "Reviewer" },
  ],
};

async function openSession(h: ReturnType<typeof harness>, name = "Reviewer") {
  const ack = await h.command(`whisper ${name}`);
  const [rootTs] = h.postedTo(DM);
  if (!rootTs) throw new Error("no whisper root was posted");
  return { ack, rootTs };
}

describe("parseWhisperRequest", () => {
  it("reads the quoted tail as the message and the head as the agent", () => {
    expect(parseWhisperRequest(' Reviewer "is this PR safe?" ')).toEqual({
      name: "Reviewer",
      message: "is this PR safe?",
    });
  });

  it("names no agent when the message comes first", () => {
    expect(parseWhisperRequest('"just between us"')).toEqual({
      name: "",
      message: "just between us",
    });
  });

  it("accepts the curly quotes Slack clients substitute", () => {
    expect(parseWhisperRequest("Scribe “keep this quiet”")).toEqual({
      name: "Scribe",
      message: "keep this quiet",
    });
  });

  /**
   * TEST_SCENARIO: Unquoted text is only ever a name. Reading it as a message
   * would send a mistyped agent name to the default agent as if it were what
   * the person meant to whisper.
   */
  it("treats unquoted text as a name with no message", () => {
    expect(parseWhisperRequest("Reviewr")).toEqual({
      name: "Reviewr",
      message: null,
    });
  });

  it("treats an empty quote as no message", () => {
    expect(parseWhisperRequest('Scribe ""')).toEqual({
      name: "Scribe",
      message: null,
    });
  });
});

describe("/dam whisper with a message", () => {
  it("relays one turn to the named agent, marked private", async () => {
    const h = harness(team);
    const ack = await h.command('whisper Reviewer "is my config leaking?"');

    expect(ack).toContain("Whispered to `Reviewer`");
    expect(h.prompts).toHaveLength(1);
    const { agent, text } = h.prompts[0]!;
    expect(agent).toBe(REVIEWER);
    expect(text).toContain("is my config leaking?");
    expect(text).toContain(`<@${USER}> whispered this to you privately`);
    expect(text).toContain("`/dam whisper`");
    expect(text).toContain(`from <#${CHANNEL}>`);
    expect(text).toContain("Keep it private");
    expect(text).not.toContain("You were @-mentioned");
  });

  it("uses the conversation's default agent when none is named", async () => {
    const h = harness(team);
    await h.command('whisper "quick question"');

    expect(h.prompts.map((p) => p.agent)).toEqual([SCRIBE]);
  });

  it("starts a fresh session for every whisper", async () => {
    const h = harness(team);
    await h.command('whisper "one"');
    await h.command('whisper "two"');

    const keys = h.prompts.map((p) => p.key);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
  });

  it("answers the whisperer alone, with an ephemeral in the channel", async () => {
    const h = harness(team, {
      onPrompt: async (instanceName, worker) => {
        expect(
          await worker.reply(instanceName, { text: "looks fine" }),
        ).toEqual({ ok: true });
      },
    });
    await h.command('whisper Reviewer "is my config leaking?"');

    const posts = h.outbound().filter((r) => r.kind !== "ephemeral");
    expect(posts).toEqual([]);
    const answer = h
      .outbound()
      .find((r) => r.kind === "ephemeral" && r.text === "looks fine");
    expect(answer).toMatchObject({ channel: CHANNEL, user: USER });
  });

  /**
   * TEST_SCENARIO: Everything else a turn can do outside its reply would show
   * the whisper to someone else — a reaction lands on a real message, a
   * hand-off has a peer answer in public, a file and a broadcast are posted to
   * the channel — so the tools refuse rather than leak it.
   */
  it("refuses every way of answering that others could see", async () => {
    const results: Record<string, unknown> = {};
    const h = harness(team, {
      onPrompt: async (instanceName, worker) => {
        results.react = await worker.react(instanceName, { emoji: "eyes" });
        results.handOff = await worker.handOffTurn(instanceName, "Scribe");
        results.file = await worker.reply(instanceName, {
          text: "see attached",
          attachment: { data: Buffer.from("x"), filename: "a.txt" },
        });
        results.broadcast = await worker.reply(instanceName, {
          text: "everyone look",
          alsoSendToChannel: true,
        });
      },
    });
    await h.command('whisper Reviewer "secret"');

    for (const result of Object.values(results))
      expect(result).toMatchObject({ error: expect.any(String) });
    expect(h.outbound().filter((r) => r.kind !== "ephemeral")).toEqual([]);
    expect(h.prompts.map((p) => p.agent)).toEqual([REVIEWER]);
  });

  it("tells the whisperer alone when the turn fails", async () => {
    const h = harness(team, { failPrompt: true });
    await h.command('whisper Reviewer "secret"');

    expect(h.outbound().filter((r) => r.kind !== "ephemeral")).toEqual([]);
    expect(
      h
        .outbound()
        .some(
          (r) =>
            r.kind === "ephemeral" &&
            r.user === USER &&
            r.text.includes("Something went wrong"),
        ),
    ).toBe(true);
  });

  it("refuses a name no connected agent has, and relays nothing", async () => {
    const h = harness(team);
    const ack = await h.command('whisper Nobody "secret"');

    expect(ack).toContain("No agent called `Nobody`");
    expect(ack).toContain("`Scribe`, `Reviewer`");
    expect(h.prompts).toEqual([]);
  });

  it("refuses in a conversation with no agent connected", async () => {
    const h = harness(team);
    const ack = await h.command('whisper "secret"', "C-ELSEWHERE");

    expect(ack).toContain("No agent is connected");
    expect(h.prompts).toEqual([]);
  });

  it("records the allow against the channel, as a whisper", async () => {
    const h = harness(team);
    await h.command('whisper Reviewer "secret"');

    const allows = h
      .security()
      .filter((r) => r.msg === "channel.authz" && r.decision === "allow");
    expect(allows).toHaveLength(1);
    expect(allows[0]).toMatchObject({
      agentId: REVIEWER,
      detail: {
        basis: "place",
        trigger: "whisper",
        slackUserId: USER,
        channelId: CHANNEL,
      },
    });
  });
});

describe("/dam whisper with no message", () => {
  it("opens a thread in the whisperer's DM and says where", async () => {
    const h = harness(team);
    const { ack, rootTs } = await openSession(h);

    expect(ack).toContain("Opened a whisper with `Reviewer`");
    expect(rootTs).toBeDefined();
    expect(h.prompts).toEqual([]);
    expect(h.security().some((r) => r.msg === "channel.whisper_opened")).toBe(
      true,
    );
  });

  it("routes replies in that thread to the agent, though the DM is unbound", async () => {
    const h = harness(team, {
      onPrompt: async (instanceName, worker) => {
        await worker.reply(instanceName, { text: "go on" });
      },
    });
    const { rootTs } = await openSession(h);
    await h.replyInDm(rootTs, "so about that bug");

    expect(h.prompts.map((p) => p.agent)).toEqual([REVIEWER]);
    const text = h.prompts[0]!.text;
    expect(text).toContain("so about that bug");
    expect(text).toContain("where the whisper continues");
    expect(text).toContain(`from <#${CHANNEL}>`);
    expect(
      h.outbound().find((r) => r.kind === "message" && r.text === "go on"),
    ).toMatchObject({ channel: DM, threadTs: rootTs });
  });

  /**
   * TEST_SCENARIO: A whisper thread overrides the DM's own binding for that
   * thread only. Messages outside it still reach whoever the person bound to
   * the DM, so opening a whisper never takes their own DM agent away.
   */
  it("overrides the DM's own binding inside the thread only", async () => {
    const h = harness({
      ...team,
      [DM]: [{ instanceName: "agent-mine", name: "Mine", isDefault: true }],
    });
    const { rootTs } = await openSession(h);
    await h.replyInDm(rootTs, "inside the whisper");
    await h.gw.fireDirectMessage({
      user: USER,
      channel: DM,
      ts: "3000.000001",
      text: "outside it",
      channelType: "im",
    });

    expect(
      h.prompts.map((p) => [p.agent, p.text.includes("whispered")]),
    ).toEqual([
      [REVIEWER, true],
      ["agent-mine", false],
    ]);
  });

  it("ends when the agent is no longer connected where it started", async () => {
    const bindings: Record<string, Spec[]> = { [CHANNEL]: [...team[CHANNEL]!] };
    const h = harness(bindings);
    const { rootTs } = await openSession(h);
    bindings[CHANNEL] = bindings[CHANNEL]!.filter(
      (s) => s.instanceName !== REVIEWER,
    );
    await h.replyInDm(rootTs, "still there?");

    expect(h.prompts).toEqual([]);
    expect(
      h
        .outbound()
        .some(
          (r) => r.kind === "ephemeral" && r.text.includes("whisper has ended"),
        ),
    ).toBe(true);
  });

  /**
   * TEST_SCENARIO: Channel membership is the only per-person gate. Someone
   * removed from the channel must not keep a private line to its agent through
   * a whisper thread opened while they were still in it.
   */
  it("ends when the whisperer has left the channel", async () => {
    const h = harness(team);
    const { rootTs } = await openSession(h);
    h.gw.setChannels([{ id: CHANNEL, name: "team", botIsMember: true }]);
    await h.replyInDm(rootTs, "still there?");

    expect(h.prompts).toEqual([]);
    expect(
      h
        .security()
        .some(
          (r) =>
            r.msg === "channel.authz_deny" && r.reason === "whisper-not-member",
        ),
    ).toBe(true);
  });

  it("ignores a thread whose root the bot did not post as a whisper", async () => {
    const h = harness({
      ...team,
      [DM]: [{ instanceName: "agent-mine", name: "Mine", isDefault: true }],
    });
    await h.command("whisper Reviewer");
    h.gw.setMessage(DM, {
      ts: "1500.000001",
      user: USER,
      text: "my own thread",
      metadata: {
        eventType: "agent_whisper_session",
        payload: { agent_id: REVIEWER, origin: CHANNEL, user: USER },
      },
    });
    await h.replyInDm("1500.000001", "reply");

    expect(h.prompts.map((p) => p.agent)).toEqual(["agent-mine"]);
  });
});
