/* TEST_OVERVIEW: a Starter Kit applied to an Agent that already exists. The
apply runs the steps of a create from a kit on that Agent: it grants the
connections it is given, adds the kit's env, records the Kit Version and Seed
Stamp, queues the seed and the install, creates the schedules, binds the Slack
channels and wakes the Agent. It first claims the Agent's Kit Version, so
two applies cannot both go on. It refuses before it changes anything when the
Agent already has a kit, the kit brings its own image, a required connection
is missing, or a schedule or env variable clashes. It names what only a create
sets, and a Kit Update then works on the Agent. */
import { describe, expect, it } from "vitest";
import type {
  Agent,
  ConnectionTemplateView,
  ConnectionView,
  ResolvedStarterKit,
  Schedule,
  StarterKitApplyToAgentInput,
} from "api-server-api";
import { ChannelType, starterKitSchema } from "api-server-api";
import {
  createStarterKitsService,
  type LoadedKit,
} from "../../modules/starter-kits/services/starter-kits-service.js";
import type { KitStamp } from "../../modules/starter-kits/services/kit-apply-existing.js";
import type { RuntimeMutator } from "../../modules/runtime-delivery/index.js";

type BumpedEvent = Parameters<RuntimeMutator["bump"]>[1][number];

const SEED_COMMIT = "a".repeat(40);
const NEWER_COMMIT = "b".repeat(40);

function kit(overrides: Partial<ResolvedStarterKit> = {}): ResolvedStarterKit {
  return starterKitSchema.parse({
    schemaVersion: "v1",
    id: "code-reviewer",
    name: "Code reviewer",
    description: "Reviews pull requests.",
    category: "software",
    seed: {
      url: "https://github.com/acme/code-guardian",
      ref: "main",
      commit: SEED_COMMIT,
      into: "home",
    },
    connections: [{ accepts: ["github-app"], required: true }],
    env: [{ name: "REVIEW_MODE", value: "strict" }],
    install: { command: "make setup" },
    schedules: [{ name: "review", cron: "*/5 * * * *", task: "Review." }],
    onboarding: { command: "onboard" },
    ...overrides,
  }) as ResolvedStarterKit;
}

function loaded(k: ResolvedStarterKit = kit()): LoadedKit {
  return {
    kit: k,
    catalog: "platform",
    version: "abc123",
    source: "/catalog",
    skillsInKit: [],
    publisher: { kind: "team" },
  };
}

function existingAgent(extra: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    name: "helper",
    spec: {
      name: "helper",
      image: "quay.io/example/default:latest",
      env: [{ name: "TZ", value: "Europe/Prague" }],
    },
    state: "running",
    effectiveHibernationTimeoutMin: 30,
    stopRequested: false,
    overBudget: false,
    podRestarts: 0,
    contributionFailures: [],
    unsupportedContributionKinds: [],
    workspaceFailures: [],
    features: { liveUpdates: false },
    channels: [],
    ...extra,
  };
}

function connection(id: string, templateId: string): ConnectionView {
  return {
    id,
    ownerId: "user-1",
    templateId,
    category: "app",
    name: id,
    status: "active",
    authKind: "oauth",
    contributions: [],
    hosts: [],
  } as ConnectionView;
}

const TEMPLATES = [
  { id: "github-app", name: "GitHub App" },
  { id: "slack", name: "Slack" },
] as ConnectionTemplateView[];

function makeHarness(
  kitToApply: LoadedKit,
  opts: {
    agent?: Agent | null;
    granted?: string[];
    schedules?: string[];
    refuseSlack?: string;
    upstreamHead?: string;
    beforeClaim?: () => Promise<void>;
    failSchedules?: boolean;
  } = {},
) {
  let agent = opts.agent === undefined ? existingAgent() : opts.agent;
  const calls = {
    created: 0,
    deleted: 0,
    granted: [] as string[][],
    updates: [] as { env?: unknown; requireConnectionAddress?: boolean }[],
    stamps: [] as KitStamp[],
    bumped: [] as BumpedEvent[],
    schedules: [] as string[],
    slack: [] as string[],
    disconnected: [] as string[],
    announced: [] as string[],
    woken: [] as string[],
    claims: [] as string[],
    released: [] as string[],
  };
  const changed = () =>
    calls.granted.length +
    calls.updates.length +
    calls.stamps.length +
    calls.bumped.length +
    calls.schedules.length +
    calls.woken.length;
  const service = createStarterKitsService({
    owner: "user-1",
    surface: "cli",
    repo: {
      list: async () => [kitToApply],
      get: async (catalog, id) =>
        catalog === kitToApply.catalog && id === kitToApply.kit.id
          ? kitToApply
          : null,
    },
    agents: {
      create: async () => {
        calls.created++;
        throw new Error("an apply to an existing agent creates none");
      },
      delete: async () => {
        calls.deleted++;
      },
      get: async (id) => (agent && agent.id === id ? agent : null),
      list: async () => (agent ? [agent] : []),
      update: async (input) => {
        calls.updates.push(input);
        return agent;
      },
      connectSlack: async (_id, channel) => {
        if (channel === opts.refuseSlack)
          return {
            ok: false,
            error: { type: "NotChannelMember" },
          } as never;
        calls.slack.push(channel);
        return { ok: true, value: agent } as never;
      },
      disconnectSlack: async (_id, channel) => {
        calls.disconnected.push(channel ?? "");
        return agent;
      },
      announceSlackConnect: async (_id, channel) => {
        calls.announced.push(channel);
      },
    },
    schedules: {
      createCron: async (input) => {
        if (opts.failSchedules) throw new Error("schedules down");
        calls.schedules.push(input.name);
        return { id: `s-${input.name}`, name: input.name } as Schedule;
      },
      createRRule: async (input) => {
        calls.schedules.push(input.name);
        return { id: `s-${input.name}`, name: input.name } as Schedule;
      },
      toggle: async () => null,
      list: async () =>
        [...(opts.schedules ?? []), ...calls.schedules].map((name) => ({
          name,
          spec: { enabled: true },
        })) as Schedule[],
    },
    connections: {
      listConnections: async () => [
        connection("c-gh", "github-app"),
        connection("c-slack", "slack"),
      ],
      listTemplates: async () => TEMPLATES,
      getAgentConnections: async (agentId) => ({
        agentId,
        connections: (opts.granted ?? []).map((connectionId) => ({
          connectionId,
          grantedAt: "2026-11-01T00:00:00Z",
          preferred: false,
        })),
      }),
      updateAgentConnections: async (_id, change) => {
        calls.granted.push(change.grant);
      },
    },
    skills: {
      applyEntries: async () => ({ installed: [], added: 0, skipped: [] }),
    },
    readTemplateSpec: async () => null,
    wakeAgent: async (id) => {
      calls.woken.push(id);
    },
    markAgentOnboarded: async (_id, at) => {
      if (agent) agent = { ...agent, starterKitOnboarded: at };
    },
    egressRules: { seed: async () => {} },
    kitUpstream: {
      head: async () =>
        opts.upstreamHead
          ? { status: "resolved", sha: opts.upstreamHead }
          : { status: "unreachable" },
      changes: async () => {
        throw new Error("not read in these tests");
      },
    },
    kitUpdateMarks: {
      begin: async () => {},
      end: async () => {},
      skip: async () => {},
      nudge: async () => false,
    },
    kitClaim: {
      claim: async (_id, ref) => {
        await opts.beforeClaim?.();
        if (!agent || agent.starterKit) return false;
        agent = { ...agent, starterKit: ref };
        calls.claims.push(ref);
        return true;
      },
      release: async (_id, ref) => {
        if (agent?.starterKit === ref) {
          const { starterKit: _released, ...rest } = agent;
          agent = rest;
        }
        calls.released.push(ref);
      },
    },
    stampKit: async (_id, stamp) => {
      calls.stamps.push(stamp);
      if (agent)
        agent = {
          ...agent,
          starterKit: stamp.starterKit,
          ...(stamp.seed ? { starterKitSeed: stamp.seed } : {}),
          ...(stamp.kbShareRoots ? { kbShareRoots: stamp.kbShareRoots } : {}),
        };
    },
    linkedKits: {
      read: async () => {
        throw new Error("no linked kit in this test");
      },
    },
    sessionPair: async () => undefined,
    runtimeMutator: {
      bump: async (_id, events) => {
        calls.bumped.push(...events);
        return 1;
      },
      enqueueAfterCommit: async () => {},
    },
  });
  return { service, calls, changed, agentNow: () => agent };
}

function input(
  extra: Partial<StarterKitApplyToAgentInput> = {},
): StarterKitApplyToAgentInput {
  return {
    catalog: "platform",
    kitId: "code-reviewer",
    agentId: "agent-1",
    connectionIds: ["c-gh"],
    skipSchedules: [],
    scheduleOverrides: [],
    ...extra,
  };
}

describe("starter kits: apply to an existing agent", () => {
  /* TEST_SCENARIO: the main path. The Agent is not created again, so it keeps
  its id; its own env stays and the kit's is added; the Kit Version and Seed
  Stamp are recorded; the seed is queued before the install that runs in it. */
  it("sets the kit up on the agent it is given, and creates no agent", async () => {
    const { service, calls } = makeHarness(loaded());
    const result = await service.applyToAgent(
      input({ slackChannelIds: ["C1"] }),
    );

    expect(calls.created).toBe(0);
    expect(calls.deleted).toBe(0);
    expect(result.agent.id).toBe("agent-1");
    expect(result.agent.starterKit).toBe("platform/code-reviewer@abc123");
    expect(calls.granted).toEqual([["c-gh"]]);
    expect(calls.updates).toEqual([
      {
        id: "agent-1",
        env: [
          { name: "TZ", value: "Europe/Prague" },
          { name: "REVIEW_MODE", value: "strict" },
        ],
      },
    ]);
    expect(calls.stamps).toEqual([
      {
        starterKit: "platform/code-reviewer@abc123",
        seed: {
          url: "https://github.com/acme/code-guardian",
          branch: "main",
          commit: SEED_COMMIT,
        },
      },
    ]);
    expect(calls.bumped.map((e) => e.kind)).toEqual([
      "workspace-seed",
      "workspace-command",
      "initialization",
    ]);
    expect(calls.bumped[0]!.payload).toMatchObject({
      url: "https://github.com/acme/code-guardian",
      into: "home",
      commit: SEED_COMMIT,
      branch: "main",
    });
    expect(calls.schedules).toEqual(["review"]);
    expect(calls.slack).toEqual(["C1"]);
    expect(calls.announced).toEqual(["C1"]);
    expect(calls.woken).toEqual(["agent-1"]);
    expect(result.kept).toEqual([]);
  });

  /* TEST_SCENARIO: the issue's done-when: once a kit is applied, a Kit Update
  sees the Agent, because the apply wrote the same stamp a create writes. */
  it("leaves the agent where a kit update offers the next version", async () => {
    const h = makeHarness(loaded(), { upstreamHead: NEWER_COMMIT });
    expect(await h.service.updates()).toEqual([]);

    await h.service.applyToAgent(input());

    expect(await h.service.updates()).toEqual([
      expect.objectContaining({
        agentId: "agent-1",
        state: "available",
        current: SEED_COMMIT,
        latest: NEWER_COMMIT,
      }),
    ]);
  });

  /* TEST_SCENARIO: a connection the Agent already holds meets a requirement
  and is not granted again. */
  it("counts the agent's own connections toward the kit's requirements", async () => {
    const { service, calls } = makeHarness(loaded(), { granted: ["c-gh"] });
    await service.applyToAgent(input({ connectionIds: [] }));
    expect(calls.granted).toEqual([]);
  });

  /* TEST_SCENARIO: what only a create sets — the workspace size, the harness,
  the egress preset and the default model — stays as the Agent has it, and
  the result names each with what the kit asks for. */
  it("names the parts only a create sets, and keeps the agent's", async () => {
    const { service } = makeHarness(
      loaded(
        kit({
          resources: { storage: "10Gi" },
          harnesses: ["claude-code"],
          egressPreset: "all",
          defaultModel: "claude-opus-5",
        }),
      ),
      {
        agent: existingAgent({
          spec: { name: "helper", image: "x", harness: "codex" },
        }),
      },
    );
    const result = await service.applyToAgent(input());
    expect(result.kept).toEqual([
      { part: "storage", kit: "10Gi" },
      { part: "harness", kit: "claude-code" },
      { part: "egress-preset", kit: "all" },
      { part: "default-model", kit: "claude-opus-5" },
    ]);
  });

  it("adds the kit's knowledge-base share roots to the agent's own", async () => {
    const { service, calls } = makeHarness(
      loaded(kit({ knowledgeBase: { shareRoots: ["notes", "docs"] } })),
      { agent: existingAgent({ kbShareRoots: ["docs"] }) },
    );
    await service.applyToAgent(input());
    expect(calls.stamps[0]!.kbShareRoots).toEqual(["docs", "notes"]);
  });

  describe("refuses before it changes anything", () => {
    /* TEST_SCENARIO: each conflict is refused with a message that says what
    to do, and the Agent is left exactly as it was. */
    it.each([
      {
        why: "the agent already has a kit",
        harness: () =>
          makeHarness(loaded(), {
            agent: existingAgent({ starterKit: "platform/other@1" }),
          }),
        code: "CONFLICT",
        message: /already set up from the starter kit platform\/other@1/,
      },
      {
        why: "the kit brings its own image",
        harness: () =>
          makeHarness(loaded(kit({ image: { ref: "quay.io/acme/reviewer" } }))),
        code: "CONFLICT",
        message: /runs on its own image \(quay\.io\/acme\/reviewer\)/,
      },
      {
        why: "a required connection is missing",
        harness: () => makeHarness(loaded()),
        input: { connectionIds: [] },
        code: "BAD_REQUEST",
        message: /missing required connection: github-app/i,
      },
      {
        why: "a kit schedule has the name of one the agent has",
        harness: () => makeHarness(loaded(), { schedules: ["review"] }),
        code: "CONFLICT",
        message: /already has a schedule named review/,
      },
      {
        why: "a kit env variable has another value on the agent",
        harness: () =>
          makeHarness(loaded(), {
            agent: existingAgent({
              spec: {
                name: "helper",
                image: "x",
                env: [{ name: "REVIEW_MODE", value: "lenient" }],
              },
            }),
          }),
        code: "CONFLICT",
        message: /already sets REVIEW_MODE to another value/,
      },
      {
        why: "the agent is not the caller's",
        harness: () => makeHarness(loaded(), { agent: null }),
        code: "NOT_FOUND",
        message: /NOT_FOUND/,
      },
    ])("when $why", async (c) => {
      const { service, calls, changed, agentNow } = c.harness();
      const kitBefore = agentNow()?.starterKit;
      await expect(
        service.applyToAgent(input(c.input ?? {})),
      ).rejects.toMatchObject({
        code: c.code,
        message: expect.stringMatching(c.message),
      });
      expect(changed()).toBe(0);
      expect(calls.slack).toEqual([]);
      expect(agentNow()?.starterKit).toBe(kitBefore);
    });

    it("lets a skipped schedule through when its name is taken", async () => {
      const { service, calls } = makeHarness(loaded(), {
        schedules: ["review"],
      });
      await service.applyToAgent(input({ skipSchedules: ["review"] }));
      expect(calls.schedules).toEqual([]);
    });

    it("takes a kit env variable the agent already sets to the same value", async () => {
      const { service, calls } = makeHarness(loaded(), {
        agent: existingAgent({
          spec: {
            name: "helper",
            image: "x",
            env: [{ name: "REVIEW_MODE", value: "strict" }],
          },
        }),
      });
      await service.applyToAgent(input());
      expect(calls.updates).toEqual([]);
    });

    /* TEST_SCENARIO: Slack is the one check that only the bind itself can
    make, so the binds run first, and a refused one unbinds the channels this
    apply bound before it. */
    it("unbinds the channels it bound when a later one is refused", async () => {
      const { service, calls, changed } = makeHarness(loaded(), {
        refuseSlack: "C2",
      });
      await expect(
        service.applyToAgent(input({ slackChannelIds: ["C1", "C2"] })),
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: expect.stringMatching(/^The kit was not applied: /),
      });
      expect(calls.slack).toEqual(["C1"]);
      expect(calls.disconnected).toEqual(["C1"]);
      expect(changed()).toBe(0);
      expect(calls.released).toEqual(["platform/code-reviewer@abc123"]);
    });

    /* TEST_SCENARIO: two applies on one Agent read it before either changes
    it. The claim is a compare-and-set on the Kit Version, so only one of them
    goes on; the other is refused before it reads the Agent again or changes
    anything, and the Agent ends with one kit and one set of changes. */
    it("refuses the second of two applies racing on one agent", async () => {
      const other = loaded(kit({ id: "code-reviewer" }));
      const { service, calls, agentNow } = makeHarness(other);
      const [first, second] = await Promise.allSettled([
        service.applyToAgent(input()),
        service.applyToAgent(input()),
      ]);
      expect(first.status).toBe("fulfilled");
      expect(second).toMatchObject({
        status: "rejected",
        reason: {
          code: "CONFLICT",
          message: expect.stringMatching(
            /another starter kit is being applied/,
          ),
        },
      });
      expect(calls.claims).toEqual(["platform/code-reviewer@abc123"]);
      expect(calls.granted).toEqual([["c-gh"]]);
      expect(calls.schedules).toEqual(["review"]);
      expect(agentNow()?.starterKit).toBe("platform/code-reviewer@abc123");
    });

    /* TEST_SCENARIO: a failure after the claim and before the kit is recorded
    gives the claim back, so the Agent is not left looking set up from a kit
    and the user can apply it again. */
    it("releases its claim when a later step fails", async () => {
      const { service, calls, agentNow } = makeHarness(loaded(), {
        failSchedules: true,
      });
      await expect(service.applyToAgent(input())).rejects.toThrow(
        "schedules down",
      );
      expect(calls.released).toEqual(["platform/code-reviewer@abc123"]);
      expect(agentNow()?.starterKit).toBeUndefined();
      expect(calls.stamps).toEqual([]);
    });

    it("does not bind again a channel the agent is already in", async () => {
      const { service, calls } = makeHarness(loaded(), {
        agent: existingAgent({
          channels: [{ type: ChannelType.Slack, slackChannelId: "C1" }],
        }),
      });
      await service.applyToAgent(input({ slackChannelIds: ["C1"] }));
      expect(calls.slack).toEqual([]);
      expect(calls.announced).toEqual([]);
    });
  });
});
