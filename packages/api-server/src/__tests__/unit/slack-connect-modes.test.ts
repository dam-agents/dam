import { describe, it, expect } from "vitest";
import type { ChannelConfig } from "api-server-api";
import { createAgentsService } from "../../modules/agents/services/agents-service.js";
import { parseInfraAgent } from "../../modules/agents/infrastructure/agent-mappers.js";
import { configureLogger } from "../../core/logger.js";

/**
 * TEST_OVERVIEW: What a re-connect of a Slack binding writes for its two
 * modes, ambient and channel history. A mode the re-connect names is set; a
 * mode it leaves out keeps what the binding had, so a surface that changes
 * one never turns the other off. Turning channel history on for a binding
 * that has it off needs the person in the conversation with the bot, as a new
 * connect does, because it opens the conversation's past to the Agent.
 */

configureLogger({ level: "error", write: () => {} });

type AgentsDeps = Parameters<typeof createAgentsService>[0];

function unused<T extends object>(fields: Partial<T> = {}): T {
  return new Proxy(fields, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected dependency: ${String(key)}`);
    },
  }) as T;
}

const OWNER = "kc|owner-1";

function harness(opts: {
  bound: { ambient: boolean; history: boolean };
  member: boolean;
}) {
  const infra = parseInfraAgent({
    metadata: {
      name: "agent-1",
      labels: { "agent-platform.ai/owner": OWNER },
    },
    spec: { name: "my-agent", image: "img:1" },
  });
  const written: ChannelConfig[] = [];
  const membershipChecks: string[] = [];

  const agents = createAgentsService({
    owner: OWNER,
    actor: OWNER,
    repo: unused<AgentsDeps["repo"]>({ get: async () => infra }),
    agentDefaultLimits: { cpu: "1", memory: "1Gi" },
    agentIdleTimeoutMinutes: 5,
    cleanupHooks: [],
    readTemplateSpec: async () => null,
    contributionsProgress: unused(),
    onboardingChecklists: { readMany: async () => new Map() },
    unitOfWork: ((fn: (tx: unknown) => unknown) =>
      fn(unused())) as AgentsDeps["unitOfWork"],
    channelsTxRepo: {
      upsertChannel: async (
        _tx: unknown,
        _agentId: string,
        channel: ChannelConfig,
      ) => {
        written.push(channel);
      },
      listByAgent: async () => [],
      claimDefaultIfVacant: async () => false,
    },
    resolveSlackWorkspace: async () => ({ kind: "unreachable" }),
    findSlackBindings: async () => [
      {
        agentId: "agent-1",
        owner: OWNER,
        teamId: "T-1",
        ambient: opts.bound.ambient,
        history: opts.bound.history,
        isDefault: true,
      },
    ],
    slackChannelMembership: async (_sub: string, channelId: string) => {
      membershipChecks.push(channelId);
      return opts.member
        ? { kind: "member" as const, slackUserId: "U-7" }
        : { kind: "not-member" as const };
    },
  } as unknown as AgentsDeps);

  return { agents, written, membershipChecks };
}

describe("a Slack re-connect and the modes it leaves out", () => {
  /**
   * TEST_SCENARIO: The CLI's --history alone, or the switch flipped on the
   * page after a bind, names only channel history; ambient mode, on in the
   * binding, must stay on.
   */
  it("keeps a mode the re-connect leaves out", async () => {
    const h = harness({
      bound: { ambient: true, history: false },
      member: true,
    });

    const res = await h.agents.connectSlack("agent-1", "C-1", {
      history: true,
    });

    expect(res.ok).toBe(true);
    expect(h.written).toEqual([
      expect.objectContaining({ ambient: true, history: true }),
    ]);
  });

  it("turns a mode off only when the re-connect says so", async () => {
    const h = harness({
      bound: { ambient: true, history: true },
      member: false,
    });

    const res = await h.agents.connectSlack("agent-1", "C-1", {
      ambient: false,
    });

    expect(res.ok).toBe(true);
    expect(h.written).toHaveLength(1);
    expect(h.written[0]).toMatchObject({ history: true });
    expect(h.written[0]).not.toHaveProperty("ambient");
  });
});

describe("turning channel history on for a binding that has it off", () => {
  /**
   * TEST_SCENARIO: An owner who left a private channel still owns its
   * binding; turning channel history on from the web app would let them read
   * the channel's past through their Agent, so the person must be in it.
   */
  it("needs the person in the conversation, and writes nothing when they are not", async () => {
    const h = harness({
      bound: { ambient: false, history: false },
      member: false,
    });

    const res = await h.agents.connectSlack("agent-1", "C-1", {
      history: true,
    });

    expect(res).toEqual({ ok: false, error: { type: "NotChannelMember" } });
    expect(h.membershipChecks).toEqual(["C-1"]);
    expect(h.written).toEqual([]);
  });

  it("asks nothing to turn ambient on or channel history off", async () => {
    const off = harness({
      bound: { ambient: false, history: true },
      member: false,
    });
    expect(
      (
        await off.agents.connectSlack("agent-1", "C-1", {
          ambient: true,
          history: false,
        })
      ).ok,
    ).toBe(true);
    expect(off.membershipChecks).toEqual([]);
    expect(off.written[0]).toMatchObject({ ambient: true });
    expect(off.written[0]).not.toHaveProperty("history");
  });
});
