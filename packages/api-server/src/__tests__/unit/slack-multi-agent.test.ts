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
  owner?: string;
}

function harness(
  agentSpecs: AgentSpec[],
  hooks: {
    onPrompt?: (
      instanceName: string,
      worker: () => SlackWorker,
    ) => Promise<void> | void;
    linkedSub?: string | null;
    bindings?: AgentSpec[];
  } = {},
) {
  const gw = createFakeSlackGateway();
  gw.setChannels([{ id: CHANNEL, name: "shared", botIsMember: true }]);

  const prompts: Array<{ agent: string; text: string }> = [];
  const threadKeys: Array<{ agent: string; key: string }> = [];
  const defaultCalls: Array<{ agentId: string; channelId: string }> = [];
  const ownerOf = (instanceName: string) =>
    agentSpecs.find((a) => a.instanceName === instanceName)?.owner ?? OWNER;

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
    {
      resolve: async () =>
        hooks.linkedSub === undefined ? OWNER : hooks.linkedSub,
    } as never,
    { authUrl: "http://kc", clientId: "c" } as never,
    createMemoryTtlStore(600_000),
    async (agentId: string) => ownerOf(agentId),
    {
      resolveSlackBindings: async () =>
        (hooks.bindings ?? agentSpecs).map((spec) => ({
          instanceName: spec.instanceName,
          owner: ownerOf(spec.instanceName),
          ambient: spec.ambient === true,
          isDefault: spec.isDefault === true,
        })),
      resolveSlackChannelsByInstance: async () => [CHANNEL],
    } as never,
    async () => {},
    async () => {},
    async (agentId: string, channelId: string) => {
      defaultCalls.push({ agentId, channelId });
      return true;
    },
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
    defaultCalls,
    async command(text: string, userId = "U-HUMAN") {
      await this.start();
      return gw.fireCommand({ text, userId, channelId: CHANNEL });
    },
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
  /**
   * TEST_SCENARIO: read-along agents must not run concurrently or they talk
   * over each other. The default agent goes first wherever it sits in the
   * roster; the rest follow in no guaranteed order.
   */
  it("runs the agents one at a time, the default first", async () => {
    const order: string[] = [];
    const h = harness(
      [
        { instanceName: REVIEWER, name: "Reviewer", ambient: true },
        {
          instanceName: SCRIBE,
          name: "Scribe",
          isDefault: true,
          ambient: true,
        },
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

describe("choosing the default agent in-chat", () => {
  const OTHER_OWNER = "kc|owner-2";

  it("reports the current default and the whole roster", async () => {
    const h = harness(both());
    const ack = await h.command("default");
    expect(ack).toContain("`Scribe` is this channel's default agent");
    expect(ack).toContain("• `Scribe` — default");
    expect(ack).toContain("• `Reviewer`");
    expect(h.defaultCalls).toEqual([]);
  });

  it("marks which connected agents read along", async () => {
    const h = harness([
      { instanceName: SCRIBE, name: "Scribe", isDefault: true },
      { instanceName: REVIEWER, name: "Reviewer", ambient: true },
    ]);
    expect(await h.command("default")).toContain("`Reviewer` (reads along)");
  });

  it("changes the default when the agent's owner asks", async () => {
    const h = harness(both());
    const ack = await h.command("default Reviewer");
    expect(ack).toContain("`Reviewer` is now this channel's default agent");
    expect(ack).toContain("not `Scribe`");
    expect(ack).toContain("reachable by name");
    expect(h.defaultCalls).toEqual([{ agentId: REVIEWER, channelId: CHANNEL }]);
  });

  /**
   * TEST_SCENARIO: the default agent takes every unnamed mention, so the load
   * lands on whoever's credentials run it — only that agent's owner may accept
   * it. Being non-default costs an agent nothing, so no consent is needed from
   * the one losing it.
   */
  it("refuses someone who does not own the agent they are promoting", async () => {
    const h = harness(
      [
        { instanceName: SCRIBE, name: "Scribe", isDefault: true },
        { instanceName: REVIEWER, name: "Reviewer", owner: OTHER_OWNER },
      ],
      { linkedSub: OWNER },
    );
    const ack = await h.command("default Reviewer");
    expect(ack).toContain("Only `Reviewer`'s owner");
    expect(h.defaultCalls).toEqual([]);
  });

  it("asks an unlinked invoker to link first", async () => {
    const h = harness(both(), { linkedSub: null });
    const ack = await h.command("default Reviewer");
    expect(ack).toContain("Link your account first");
    expect(h.defaultCalls).toEqual([]);
  });

  it("says so when the named agent is already the default", async () => {
    const h = harness(both());
    const ack = await h.command("default Scribe");
    expect(ack).toContain("already this channel's default");
    expect(h.defaultCalls).toEqual([]);
  });

  it("refuses an agent that is not connected here, listing who is", async () => {
    const h = harness(both());
    const ack = await h.command("default Nobody");
    expect(ack).toContain("No agent called `Nobody`");
    expect(ack).toContain("• `Scribe`");
    expect(h.defaultCalls).toEqual([]);
  });

  it("refuses an ambiguous name rather than guessing", async () => {
    const h = harness([
      { instanceName: SCRIBE, name: "Twin", isDefault: true },
      { instanceName: REVIEWER, name: "Twin" },
    ]);
    const ack = await h.command("default Twin");
    expect(ack).toContain("More than one agent");
    expect(h.defaultCalls).toEqual([]);
  });

  it("matches a multi-word agent name", async () => {
    const h = harness([
      { instanceName: SCRIBE, name: "Scribe", isDefault: true },
      { instanceName: REVIEWER, name: "Release Captain" },
    ]);
    const ack = await h.command("default release captain");
    expect(ack).toContain("`Release Captain` is now this channel's default");
    expect(h.defaultCalls).toHaveLength(1);
  });

  it("says nothing is connected when every agent has been released", async () => {
    const h = harness(both(), { bindings: [] });
    expect(await h.command("default")).toContain("isn't connected to an agent");
  });

  it("lists default alongside the other commands in the usage help", async () => {
    const h = harness(both());
    expect(await h.command("")).toContain("/dam default");
  });
});

describe("a conversation with no default agent", () => {
  const noDefault = (): AgentSpec[] => [
    { instanceName: SCRIBE, name: "Scribe" },
    { instanceName: REVIEWER, name: "Reviewer" },
  ];

  /**
   * TEST_SCENARIO: releasing the default leaves the conversation without one.
   * An unnamed mention must be refused rather than conscripting an agent whose
   * owner never accepted the load that being default carries.
   */
  it("refuses an unnamed mention instead of picking an agent", async () => {
    const h = harness(noDefault());
    await h.mention("<@U-BOT> can someone look at this?");
    expect(h.promptsFor(SCRIBE)).toHaveLength(0);
    expect(h.promptsFor(REVIEWER)).toHaveLength(0);
    const ephemeral = h.gw
      .readOutbound()
      .find((r) => r.kind === "ephemeral") as { text: string } | undefined;
    expect(ephemeral?.text).toContain("no default agent");
    expect(ephemeral?.text).toContain("`Scribe`");
    expect(ephemeral?.text).toContain("`Reviewer`");
    expect(ephemeral?.text).toContain("/dam default");
  });

  it("still delivers a mention that names an agent", async () => {
    const h = harness(noDefault());
    await h.mention("<@U-BOT> Reviewer take a look");
    expect(h.promptsFor(REVIEWER)).toHaveLength(1);
    expect(h.gw.readOutbound().filter((r) => r.kind === "ephemeral")).toEqual(
      [],
    );
  });

  it("explains an ambiguous name when there is no default to fall back to", async () => {
    const h = harness([
      { instanceName: SCRIBE, name: "Twin" },
      { instanceName: REVIEWER, name: "Twin" },
    ]);
    await h.mention("<@U-BOT> Twin ping");
    expect(h.promptsFor(SCRIBE)).toHaveLength(0);
    expect(h.promptsFor(REVIEWER)).toHaveLength(0);
    const ephemeral = h.gw
      .readOutbound()
      .find((r) => r.kind === "ephemeral") as { text: string } | undefined;
    expect(ephemeral?.text).toContain("More than one agent here is called");
  });

  it("reports no default set, and still lists the roster", async () => {
    const h = harness(noDefault());
    const ack = await h.command("default");
    expect(ack).toContain("no default agent set");
    expect(ack).toContain("• `Scribe`");
  });

  /**
   * TEST_SCENARIO: unbinding the default is how a channel ends up with none, so
   * the person who did it is told, and told how to set a new one.
   */
  it("says so when unbinding the default leaves the channel without one", async () => {
    const h = harness(both());
    const ack = await h.command("unbind Scribe");
    expect(ack).toContain("disconnected");
    expect(ack).toContain("reach no one until an agent's owner runs");
    expect(ack).toContain("/dam default");
  });
});

describe("handing off a read-along turn", () => {
  /**
   * TEST_SCENARIO: ambient turns build their own turn records, and a hand-off
   * rebuilds the message from them. If they omit the text, the receiving agent
   * is handed an empty message and answers nothing.
   */
  it("carries the real message text, not an empty body", async () => {
    const h = harness(
      [
        {
          instanceName: SCRIBE,
          name: "Scribe",
          isDefault: true,
          ambient: true,
        },
        { instanceName: REVIEWER, name: "Reviewer" },
      ],
      {
        onPrompt: async (agent, worker) => {
          if (agent === SCRIBE) await worker().handOffTurn(SCRIBE, "Reviewer");
        },
      },
    );
    await h.channelMessage("who owns the deploy script?");
    const handed = h.promptsFor(REVIEWER)[0];
    expect(handed).toBeDefined();
    expect(handed).toContain("who owns the deploy script?");
    expect(handed).toContain("handed this message to you");
  });

  /**
   * TEST_SCENARIO: a turn may only leave the agent once — otherwise one message
   * could be handed to every connected agent in sequence.
   */
  it("refuses a second hand-off of the same turn", async () => {
    const outcomes: unknown[] = [];
    const h = harness(
      [
        { instanceName: SCRIBE, name: "Scribe", isDefault: true },
        { instanceName: REVIEWER, name: "Reviewer" },
      ],
      {
        onPrompt: async (agent, worker) => {
          if (agent !== SCRIBE) return;
          outcomes.push(await worker().handOffTurn(SCRIBE, "Reviewer"));
          outcomes.push(await worker().handOffTurn(SCRIBE, "Reviewer"));
        },
      },
    );
    await h.mention("<@U-BOT> a question");
    await tick();
    expect(outcomes[0]).toMatchObject({ ok: true });
    expect(outcomes[1]).toMatchObject({
      error: expect.stringContaining("cannot be handed on twice"),
    });
  });
});
