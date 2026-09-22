import { describe, it, expect } from "vitest";
import type { ChannelConfig } from "api-server-api";
import { createAgentsService } from "../../modules/agents/services/agents-service.js";
import { parseInfraAgent } from "../../modules/agents/infrastructure/agent-mappers.js";
import { configureLogger } from "../../core/logger.js";

/**
 * TEST_OVERVIEW: What an in-chat bind writes, given the workspace name its flow
 * carries.
 *
 * The flow's name is canonical by construction — it is minted where the slash
 * command arrives, which is the one place that always knows the original
 * workspace's two names are one (covered where the flow is minted). This side
 * holds the write: the bind records the carried name verbatim, an empty name
 * producing exactly the row shape every pre-multi-workspace binding has, and it
 * never asks Slack — the resolver here answers "unreachable", so consulting it
 * would fail the bind rather than quietly pass.
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

function harness(flowTeamId: string) {
  const infra = parseInfraAgent({
    metadata: {
      name: "agent-1",
      labels: { "agent-platform.ai/owner": OWNER },
    },
    spec: { name: "my-agent", image: "img:1" },
  });
  const written: ChannelConfig[] = [];

  const agents = createAgentsService({
    owner: OWNER,
    repo: unused<AgentsDeps["repo"]>({ get: async () => infra }),
    agentDefaultLimits: { cpu: "1", memory: "1Gi" },
    agentIdleTimeoutMinutes: 30,
    cleanupHooks: [],
    readTemplateSpec: async () => null,
    contributionsProgress: unused(),
    onboardingChecklists: { readMany: async () => new Map() },
    avatars: { readMany: async () => new Map(), set: async () => {} },
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
    findSlackBindings: async () => [],
    slackBinding: {
      peekFlow: async () => ({
        slackChannelId: "C-1",
        teamId: flowTeamId,
        slackUserId: "U-7",
        keycloakSub: OWNER,
      }),
      consumeFlow: async () => {},
      postMessage: async () => ({ ok: true as const }),
    },
  } as unknown as AgentsDeps);

  return { agents, written };
}

describe("slack in-chat bind — what the write records", () => {
  /**
   * TEST_SCENARIO: the flow names the original workspace, canonically empty.
   * The row must carry no name at all — the shape every binding made before
   * multi-workspace support already has — so the workspace's rows never split
   * across its two names.
   */
  it("writes an empty flow name as a row with no workspace at all", async () => {
    const h = harness("");

    const res = await h.agents.bindSlackChannel("agent-1", "flow-1");

    expect(res.ok).toBe(true);
    expect(h.written).toHaveLength(1);
    expect(h.written[0]).not.toHaveProperty("teamId");
  });

  /**
   * TEST_SCENARIO: the flow names a workspace connected over OAuth, which has
   * exactly one name. It is written as carried, and Slack is never asked —
   * the resolver here would fail the bind if it were.
   */
  it("writes a named flow as carried, without probing", async () => {
    const h = harness("T-SECOND");

    const res = await h.agents.bindSlackChannel("agent-1", "flow-1");

    expect(res.ok).toBe(true);
    expect(h.written).toHaveLength(1);
    expect(h.written[0]).toMatchObject({
      slackChannelId: "C-1",
      teamId: "T-SECOND",
    });
  });
});
