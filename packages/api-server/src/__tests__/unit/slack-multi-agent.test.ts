import { createMemoryTtlStore } from "../../core/ttl-store.js";
import { describe, it, expect } from "vitest";
import type { AgentsService } from "api-server-api";
import {
  createSlackWorker,
  type SlackWorker,
} from "../../modules/channels/infrastructure/slack.js";
import { createFakeSlackGateway } from "../../modules/channels/infrastructure/fake-slack-gateway.js";
import { stubTurnAttendance } from "../helpers/turn-attendance.js";
import { stubWorkspaceFiles } from "../helpers/workspace-files.js";
import type { AcpClient, SendPromptOpts } from "../../core/acp-client.js";
import { configureLogger } from "../../core/logger.js";
import type { StoredChannelConfig } from "../../modules/channels/stored-channel.js";

/**
 * TEST_OVERVIEW: several agents connected to one Slack conversation — which one
 * a mention reaches, that ambient read-along runs them one at a time, and
 * handing a turn to a peer agent.
 */

const OWNER = "kc|owner-1";
const CHANNEL = "C-SHARED";
const SCRIBE = "agent-scribe";
const REVIEWER = "agent-reviewer";

configureLogger({ level: "error", write: () => {} });

const tick = () => new Promise((r) => setTimeout(r, 0));

interface AgentSpec {
  instanceName: string;
  name: string;
  ambient?: boolean;
  isDefault?: boolean;
}

function harness(
  agentSpecs: AgentSpec[],
  hooks: {
    onPrompt?: (
      instanceName: string,
      worker: () => SlackWorker,
    ) => Promise<void> | void;
  } = {},
) {
  const gw = createFakeSlackGateway();
  gw.setChannels([{ id: CHANNEL, name: "shared", botIsMember: true }]);

  const prompts: Array<{ agent: string; text: string }> = [];
  const threadKeys: Array<{ agent: string; key: string }> = [];

  const makeAcp = (instanceName: string): AcpClient => ({
    listSessions: async () => [],
    sendPrompt: async (prompt: unknown, sendOpts: SendPromptOpts) => {
      prompts.push({
        agent: instanceName,
        text: typeof prompt === "string" ? prompt : JSON.stringify(prompt),
      });
      if (!("resumeSessionId" in sendOpts) && sendOpts.platformMeta?.threadTs)
        threadKeys.push({
          agent: instanceName,
          key: sendOpts.platformMeta.threadTs,
        });
      await hooks.onPrompt?.(instanceName, () => worker);
      return "answer";
    },
    triggerSession: () => Promise.reject(new Error("unused")),
  });

  const agents = {
    ensureReady: async () => {},
    get: async (id: string) => {
      const spec = agentSpecs.find((a) => a.instanceName === id);
      return spec ? { id, name: spec.name } : null;
    },
  } as unknown as AgentsService;

  const worker: SlackWorker = createSlackWorker(
    makeAcp,
    () => gw,
    () => agents,
    { resolve: async () => OWNER } as never,
    { authUrl: "http://kc", clientId: "c" } as never,
    createMemoryTtlStore(600_000),
    async () => OWNER,
    {
      resolveSlackBindings: async () =>
        agentSpecs.map((spec) => ({
          instanceName: spec.instanceName,
          owner: OWNER,
          ambient: spec.ambient === true,
          isDefault: spec.isDefault === true,
        })),
      resolveSlackChannelsByInstance: async () => [CHANNEL],
    } as never,
    async () => {},
    async () => {},
    async () => null,
    { name: "DAM", short: "dam" },
    async () => true,
    "http://ui",
    stubTurnAttendance(),
    stubWorkspaceFiles(),
    () => {},
  );

  return {
    gw,
    worker,
    prompts,
    threadKeys,
    promptsFor: (agent: string) =>
      prompts.filter((p) => p.agent === agent).map((p) => p.text),
    async start() {
      for (const spec of agentSpecs)
        await worker.start(spec.instanceName, {} as StoredChannelConfig);
    },
    async mention(text: string, threadTs?: string) {
      await this.start();
      await gw.fireMention({
        user: "U-HUMAN",
        channel: CHANNEL,
        ts: "111.1",
        text,
        ...(threadTs ? { threadTs } : {}),
      });
      await tick();
    },
    async channelMessage(text: string) {
      await this.start();
      await gw.fireMessage({
        user: "U-HUMAN",
        channel: CHANNEL,
        ts: "222.2",
        text,
        channelType: "channel",
      });
      for (let i = 0; i < 8; i++) await tick();
    },
  };
}

const both = (): AgentSpec[] => [
  { instanceName: SCRIBE, name: "Scribe", isDefault: true },
  { instanceName: REVIEWER, name: "Reviewer" },
];

describe("mention routing across several connected agents", () => {
  it("sends a bare mention to the default agent only", async () => {
    const h = harness(both());
    await h.mention("<@U-BOT> what is the status?");
    expect(h.promptsFor(SCRIBE)).toHaveLength(1);
    expect(h.promptsFor(REVIEWER)).toHaveLength(0);
  });

  it("sends a mention that opens with an agent's name to that agent", async () => {
    const h = harness(both());
    await h.mention("<@U-BOT> Reviewer take a look at this");
    expect(h.promptsFor(REVIEWER)).toHaveLength(1);
    expect(h.promptsFor(SCRIBE)).toHaveLength(0);
  });

  /**
   * TEST_SCENARIO: an unrecognised leading word is ordinary prose, not an
   * address, so the default agent still answers.
   */
  it("falls back to the default agent when no name matches", async () => {
    const h = harness(both());
    await h.mention("<@U-BOT> please summarise the thread");
    expect(h.promptsFor(SCRIBE)).toHaveLength(1);
    expect(h.promptsFor(REVIEWER)).toHaveLength(0);
  });

  it("tells the addressed agent who else is connected and who is default", async () => {
    const h = harness(both());
    await h.mention("<@U-BOT> Reviewer look at this");
    const prompt = h.promptsFor(REVIEWER)[0]!;
    expect(prompt).toContain("You are not the only agent here");
    expect(prompt).toContain('"Scribe"');
    expect(prompt).toContain("not you");
  });

  it("says nothing about other agents when only one is connected", async () => {
    const h = harness([
      { instanceName: SCRIBE, name: "Scribe", isDefault: true },
    ]);
    await h.mention("<@U-BOT> hello");
    expect(h.promptsFor(SCRIBE)[0]).not.toContain("You are not the only agent");
  });

  /**
   * TEST_SCENARIO: two agents answering in the same thread must not share a
   * session — each resolves its own, keyed the same way inside its own pod.
   */
  it("gives each agent its own session for the same thread", async () => {
    const h = harness(both());
    await h.mention("<@U-BOT> Reviewer first", "900.1");
    await h.mention("<@U-BOT> second", "900.1");
    expect(h.threadKeys).toEqual([
      { agent: REVIEWER, key: `${CHANNEL}:900.1` },
      { agent: SCRIBE, key: `${CHANNEL}:900.1` },
    ]);
  });
});

describe("ambient read-along with several connected agents", () => {
  it("runs the agents one at a time, in roster order", async () => {
    const order: string[] = [];
    const h = harness(
      [
        {
          instanceName: SCRIBE,
          name: "Scribe",
          isDefault: true,
          ambient: true,
        },
        { instanceName: REVIEWER, name: "Reviewer", ambient: true },
      ],
      {
        onPrompt: async (agent) => {
          order.push(`${agent}:start`);
          await tick();
          order.push(`${agent}:end`);
        },
      },
    );
    await h.channelMessage("the build looks broken");
    expect(order).toEqual([
      `${SCRIBE}:start`,
      `${SCRIBE}:end`,
      `${REVIEWER}:start`,
      `${REVIEWER}:end`,
    ]);
  });

  it("only relays to agents that have ambient on", async () => {
    const h = harness([
      { instanceName: SCRIBE, name: "Scribe", isDefault: true, ambient: true },
      { instanceName: REVIEWER, name: "Reviewer" },
    ]);
    await h.channelMessage("just chatting");
    expect(h.promptsFor(SCRIBE)).toHaveLength(1);
    expect(h.promptsFor(REVIEWER)).toHaveLength(0);
  });

  /**
   * TEST_SCENARIO: the point of running them in order is that a later agent can
   * see an earlier one already answered, instead of repeating it.
   */
  it("tells a later agent that an earlier one already replied", async () => {
    const h = harness(
      [
        {
          instanceName: SCRIBE,
          name: "Scribe",
          isDefault: true,
          ambient: true,
        },
        { instanceName: REVIEWER, name: "Reviewer", ambient: true },
      ],
      {
        onPrompt: async (agent, worker) => {
          if (agent === SCRIBE)
            await worker().reply(SCRIBE, { text: "I have this one" });
        },
      },
    );
    await h.channelMessage("who owns the deploy script?");
    const second = h.promptsFor(REVIEWER)[0]!;
    expect(second).toContain("Scribe");
    expect(second).toContain("already replied");
  });

  it("tells a later agent when nobody before it replied", async () => {
    const h = harness([
      { instanceName: SCRIBE, name: "Scribe", isDefault: true, ambient: true },
      { instanceName: REVIEWER, name: "Reviewer", ambient: true },
    ]);
    await h.channelMessage("idle chatter");
    expect(h.promptsFor(REVIEWER)[0]).toContain(
      "Nobody before you has replied",
    );
  });
});

describe("handing a turn to another connected agent", () => {
  it("relays the message to the named agent, framed as a hand-off", async () => {
    const h = harness(both(), {
      onPrompt: async (agent, worker) => {
        if (agent === SCRIBE)
          await worker().handOffTurn(
            SCRIBE,
            "Reviewer",
            "this is a code question",
          );
      },
    });
    await h.mention("<@U-BOT> is this function correct?");
    await tick();
    const handed = h.promptsFor(REVIEWER)[0]!;
    expect(handed).toContain("is this function correct?");
    expect(handed).toContain("handed this message to you");
    expect(handed).toContain("Scribe");
    expect(handed).toContain("this is a code question");
  });

  it("refuses a hand-off to an agent that is not connected here", async () => {
    let outcome: unknown;
    const h = harness(both(), {
      onPrompt: async (agent, worker) => {
        if (agent === SCRIBE)
          outcome = await worker().handOffTurn(SCRIBE, "Nobody");
      },
    });
    await h.mention("<@U-BOT> hello");
    expect(outcome).toMatchObject({
      error: expect.stringContaining('No agent called "Nobody"'),
    });
    expect(h.promptsFor(REVIEWER)).toHaveLength(0);
  });

  it("refuses a hand-off to itself", async () => {
    let outcome: unknown;
    const h = harness(both(), {
      onPrompt: async (agent, worker) => {
        if (agent === SCRIBE)
          outcome = await worker().handOffTurn(SCRIBE, "Scribe");
      },
    });
    await h.mention("<@U-BOT> hello");
    expect(outcome).toMatchObject({
      error: expect.stringContaining("That is you"),
    });
  });

  /**
   * TEST_SCENARIO: hop limit of one — a handed-on message cannot bounce onward,
   * which is what keeps agents from passing a message in a circle.
   */
  it("refuses to hand on a message that was already handed over", async () => {
    const outcomes: unknown[] = [];
    const h = harness(both(), {
      onPrompt: async (agent, worker) => {
        if (agent === SCRIBE)
          await worker().handOffTurn(SCRIBE, "Reviewer", "over to you");
        if (agent === REVIEWER)
          outcomes.push(await worker().handOffTurn(REVIEWER, "Scribe"));
      },
    });
    await h.mention("<@U-BOT> a question");
    await tick();
    await tick();
    expect(outcomes[0]).toMatchObject({
      error: expect.stringContaining("cannot be handed on again"),
    });
  });

  it("reports a hand-off with no turn in flight rather than throwing", async () => {
    const h = harness(both());
    await h.start();
    expect(await h.worker.handOffTurn(SCRIBE, "Reviewer")).toMatchObject({
      error: expect.stringContaining("no Slack turn in flight"),
    });
  });
});
