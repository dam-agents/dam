import { describe, expect, it } from "vitest";
import { starterKitApplyInputSchema } from "api-server-api";
import type {
  Agent,
  AgentCreateInput,
  ConnectionTemplateView,
  ConnectionView,
  Schedule,
  StarterKit,
} from "api-server-api";
import { starterKitSchema } from "api-server-api";
import { composeOnboardingPrompt } from "../../modules/starter-kits/domain/onboarding-prompt.js";
import {
  parseKitRef,
  unmetRequiredConnections,
} from "../../modules/starter-kits/domain/requirements.js";
import type { LoadedKit } from "../../modules/starter-kits/infrastructure/kits-repository.js";
import { createStarterKitsService } from "../../modules/starter-kits/services/starter-kits-service.js";

function kit(overrides: Partial<StarterKit> = {}): StarterKit {
  return starterKitSchema.parse({
    schemaVersion: "v1",
    id: "code-reviewer",
    name: "Code reviewer",
    description: "Reviews pull requests.",
    category: "software",
    seed: { url: "https://github.com/acme/code-guardian", ref: "v1.4.0" },
    connections: [
      { accepts: ["github-app", "github-pat"], required: true },
      { accepts: ["slack"], note: "Nudges." },
    ],
    schedules: [
      { name: "review", cron: "*/5 8-21 * * 1-5", task: "Review." },
      {
        name: "benchmark",
        rrule: "FREQ=MONTHLY;BYMONTHDAY=1",
        timezone: "Europe/Prague",
        task: "Benchmark.",
        enabled: false,
      },
    ],
    parameters: [{ name: "repository to review", required: true }],
    ...overrides,
  });
}

function fakeAgent(id: string, extra: Partial<Agent> = {}): Agent {
  return {
    id,
    name: "reviewer",
    spec: { name: "reviewer", image: "quay.io/example/claude-code:latest" },
    state: "starting",
    effectiveHibernationTimeoutMin: 30,
    stopRequested: false,
    overBudget: false,
    contributionFailures: [],
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

function makeHarness(
  loaded: LoadedKit | null,
  agent: Agent | null = null,
  agentGrants: { connectionId: string; grantedAt: string }[] = [],
) {
  const calls = {
    created: [] as AgentCreateInput[],
    deleted: [] as string[],
    woken: [] as string[],
    onboarded: [] as { id: string; at: string }[],
    greeted: [] as { id: string; at: string }[],
    cron: [] as { name: string; agentId: string; cron: string }[],
    rrule: [] as { name: string; rrule: string; timezone: string }[],
    toggled: [] as string[],
    slack: [] as { agentId: string; channel: string; ambient?: boolean }[],
    skillEntries: [] as { agentId: string; skills: unknown[] }[],
    kbCreated: [] as { input: AgentCreateInput; kbTemplateId: string }[],
  };
  let nextScheduleId = 0;
  const service = createStarterKitsService({
    owner: "user-1",
    repo: {
      async list() {
        return loaded ? [loaded] : [];
      },
      async get(catalog, id) {
        return loaded && loaded.catalog === catalog && loaded.kit.id === id
          ? loaded
          : null;
      },
    },
    async createKnowledgeBaseAgent(input, kbTemplateId) {
      calls.kbCreated.push({ input, kbTemplateId });
      return fakeAgent("agent-1", { starterKit: input.starterKit });
    },
    agents: {
      async create(input) {
        calls.created.push(input);
        return fakeAgent("agent-1", { starterKit: input.starterKit });
      },
      async delete(id) {
        calls.deleted.push(id);
      },
      async get() {
        return agent;
      },
      async connectSlack(agentId, channel, ambient) {
        calls.slack.push({ agentId, channel, ambient });
        return { agent: fakeAgent(agentId), alreadyConnected: false } as never;
      },
    },
    schedules: {
      async createCron(input) {
        calls.cron.push(input);
        return { id: `s${++nextScheduleId}`, name: input.name } as Schedule;
      },
      async createRRule(input) {
        calls.rrule.push(input);
        return { id: `s${++nextScheduleId}`, name: input.name } as Schedule;
      },
      async toggle(id) {
        calls.toggled.push(id);
        return null;
      },
      async list() {
        return [
          { name: "review", spec: { enabled: true } },
          { name: "benchmark", spec: { enabled: false } },
        ] as Schedule[];
      },
    },
    connections: {
      async listConnections() {
        return [
          connection("c-gh", "github-app"),
          connection("c-slack", "slack"),
        ];
      },
      async listTemplates() {
        return TEMPLATES;
      },
      async getAgentConnections(agentId: string) {
        return { agentId, connections: agentGrants };
      },
    },
    skills: {
      async applyEntries(input) {
        calls.skillEntries.push(input);
        return {
          installed: [],
          added: input.skills.length - 1,
          skipped: [
            { ...input.skills[0], reason: "source-not-connected" as const },
          ],
        };
      },
    },
    wakeAgent: async (id) => {
      calls.woken.push(id);
    },
    markAgentOnboarded: async (id, at) => {
      calls.onboarded.push({ id, at });
    },
    markAgentGreeted: async (id, at) => {
      calls.greeted.push({ id, at });
    },
  });
  return { service, calls };
}

const LOADED: LoadedKit = {
  kit: kit(),
  catalog: "platform",
  version: "abc123",
  source: "/catalog",
  skillsInKit: [],
};

const GITHUB = { id: "github", title: "GitHub" };
const TEMPLATES = [
  { id: "github-app", name: "GitHub App", family: GITHUB },
  { id: "github-pat", name: "GitHub PAT", family: GITHUB },
  { id: "slack", name: "Slack" },
  { id: "ibm-litellm", name: "IBM LiteLLM" },
] as ConnectionTemplateView[];

describe("starter kits: apply", () => {
  it("creates the agent, seeds schedules with optional ones disabled, binds Slack and wakes", async () => {
    const { service, calls } = makeHarness(LOADED);
    const result = await service.apply({
      catalog: "platform",
      kitId: "code-reviewer",
      name: "reviewer",
      templateId: "claude-code",
      connectionIds: ["c-gh", "c-slack"],
      slackChannelId: "C123",
      skipSchedules: [],
      scheduleOverrides: [],
    });

    expect(result.agent.id).toBe("agent-1");
    expect(result.skills).toBeNull();
    expect(result.skillsError).toBeNull();
    expect(calls.skillEntries).toEqual([]);
    expect(calls.created).toHaveLength(1);
    expect(calls.created[0]).toMatchObject({
      name: "reviewer",
      templateId: "claude-code",
      connectionIds: ["c-gh", "c-slack"],
      starterKit: "platform/code-reviewer@abc123",
    });
    expect(calls.cron).toEqual([
      {
        name: "review",
        agentId: "agent-1",
        cron: "*/5 8-21 * * 1-5",
        task: "Review.",
        sessionMode: undefined,
      },
    ]);
    expect(calls.rrule).toMatchObject([
      {
        name: "benchmark",
        rrule: "FREQ=MONTHLY;BYMONTHDAY=1",
        timezone: "Europe/Prague",
      },
    ]);
    expect(calls.toggled).toEqual(["s2"]);
    expect(calls.slack).toEqual([
      { agentId: "agent-1", channel: "C123", ambient: false },
    ]);
    expect(calls.woken).toEqual(["agent-1"]);
    expect(calls.deleted).toEqual([]);
  });

  it("creates a kit that declares a knowledge base through the kb rail", async () => {
    const { service, calls } = makeHarness({
      ...LOADED,
      kit: kit({ knowledgeBase: { template: "plain-wiki" } }),
    });
    await service.apply({
      catalog: "platform",
      kitId: "code-reviewer",
      name: "team wiki",
      templateId: "claude-code",
      connectionIds: ["c-gh"],
      skipSchedules: ["review", "benchmark"],
      scheduleOverrides: [],
    });
    expect(calls.created).toEqual([]);
    expect(calls.kbCreated).toHaveLength(1);
    expect(calls.kbCreated[0].kbTemplateId).toBe("plain-wiki");
    expect(calls.kbCreated[0].input).toMatchObject({
      name: "team wiki",
      templateId: "claude-code",
      starterKit: "platform/code-reviewer@abc123",
    });
  });

  it("leaves out the schedules the user chose to skip", async () => {
    const { service, calls } = makeHarness(LOADED);
    await service.apply({
      catalog: "platform",
      kitId: "code-reviewer",
      name: "reviewer",
      templateId: "claude-code",
      connectionIds: ["c-gh"],
      skipSchedules: ["benchmark"],
      scheduleOverrides: [],
    });
    expect(calls.cron.map((c) => c.name)).toEqual(["review"]);
    expect(calls.rrule).toEqual([]);
    expect(calls.toggled).toEqual([]);
  });

  it("refuses when a required connection is not covered by the granted ones", async () => {
    const { service, calls } = makeHarness(LOADED);
    await expect(
      service.apply({
        catalog: "platform",
        kitId: "code-reviewer",
        name: "reviewer",
        templateId: "claude-code",
        connectionIds: ["c-slack"],
        skipSchedules: [],
        scheduleOverrides: [],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(calls.created).toEqual([]);
  });

  it("requires a harness when the kit brings no image, and uses the image when it does", async () => {
    const { service } = makeHarness(LOADED);
    await expect(
      service.apply({
        catalog: "platform",
        kitId: "code-reviewer",
        name: "r",
        connectionIds: ["c-gh"],
        skipSchedules: [],
        scheduleOverrides: [],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const pinned = makeHarness({
      ...LOADED,
      kit: kit({
        image: { ref: "quay.io/acme/nous:1.0.0" },
        connections: [],
      }),
    });
    await pinned.service.apply({
      catalog: "platform",
      kitId: "code-reviewer",
      name: "nous-1",
      templateId: "claude-code",
      connectionIds: [],
      skipSchedules: [],
      scheduleOverrides: [],
    });
    expect(pinned.calls.created[0].templateId).toBeUndefined();
    expect(pinned.calls.created[0].image).toBe("quay.io/acme/nous:1.0.0");
  });

  it("passes the kit's declared size and disk to create, image or harness", async () => {
    const own = makeHarness({
      ...LOADED,
      kit: kit({
        image: { ref: "quay.io/acme/nous:1.0.0" },
        resources: { cpu: "2", memory: "4Gi", storage: "10Gi" },
        connections: [],
      }),
    });
    await own.service.apply({
      catalog: "platform",
      kitId: "code-reviewer",
      name: "nous-1",
      connectionIds: [],
      skipSchedules: [],
      scheduleOverrides: [],
    });
    expect(own.calls.created[0].size).toEqual({ cpu: "2", memory: "4Gi" });
    expect(own.calls.created[0].storage).toBe("10Gi");

    const onHarness = makeHarness({
      ...LOADED,
      kit: kit({ resources: { storage: "20Gi" }, connections: [] }),
    });
    await onHarness.service.apply({
      catalog: "platform",
      kitId: "code-reviewer",
      name: "r",
      templateId: "claude-code",
      connectionIds: [],
      skipSchedules: [],
      scheduleOverrides: [],
    });
    expect(onHarness.calls.created[0].templateId).toBe("claude-code");
    expect(onHarness.calls.created[0].size).toBeUndefined();
    expect(onHarness.calls.created[0].storage).toBe("20Gi");
  });

  it("creates a kit schedule with the user's overrides", async () => {
    const { service, calls } = makeHarness(LOADED);
    await service.apply({
      catalog: "platform",
      kitId: "code-reviewer",
      name: "r",
      templateId: "claude-code",
      connectionIds: ["c-gh"],
      skipSchedules: [],
      scheduleOverrides: [
        {
          name: "review",
          timing: { rrule: "FREQ=DAILY;BYHOUR=7", timezone: "Europe/Prague" },
          sessionMode: "continuous",
          enabled: false,
        },
      ],
    });

    expect(calls.rrule).toContainEqual(
      expect.objectContaining({
        name: "review",
        rrule: "FREQ=DAILY;BYHOUR=7",
        timezone: "Europe/Prague",
      }),
    );
    expect(calls.cron.map((c) => c.name)).not.toContain("review");
  });

  it("rejects an override that names an rrule with no timezone", () => {
    expect(
      starterKitApplyInputSchema.safeParse({
        catalog: "platform",
        kitId: "code-reviewer",
        name: "r",
        scheduleOverrides: [
          { name: "review", timing: { rrule: "FREQ=DAILY" } },
        ],
      }).success,
    ).toBe(false);
  });

  it("deletes the agent when seeding fails after create", async () => {
    const { calls } = makeHarness(LOADED);
    const failing = createStarterKitsService({
      owner: "user-1",
      repo: { list: async () => [LOADED], get: async () => LOADED },
      createKnowledgeBaseAgent: async (input) =>
        fakeAgent("agent-2", { starterKit: input.starterKit }),
      agents: {
        create: async (input) =>
          fakeAgent("agent-2", { starterKit: input.starterKit }),
        delete: async (id) => {
          calls.deleted.push(id);
        },
        get: async () => null,
        connectSlack: async () => {
          throw new Error("nope");
        },
      },
      schedules: {
        createCron: async () => {
          throw new Error("schedules down");
        },
        createRRule: async () => {
          throw new Error("schedules down");
        },
        toggle: async () => null,
        list: async () => [],
      },
      connections: {
        listConnections: async () => [connection("c-gh", "github-app")],
        listTemplates: async () => TEMPLATES,
        getAgentConnections: async (agentId: string) => ({
          agentId,
          connections: [],
        }),
      },
      skills: {
        applyEntries: async () => ({ installed: [], added: 0, skipped: [] }),
      },
      wakeAgent: async () => {},
      markAgentOnboarded: async () => {},
      markAgentGreeted: async () => {},
    });
    await expect(
      failing.apply({
        catalog: "platform",
        kitId: "code-reviewer",
        name: "r",
        templateId: "t",
        connectionIds: ["c-gh"],
        skipSchedules: [],
        scheduleOverrides: [],
      }),
    ).rejects.toThrow("schedules down");
    expect(calls.deleted).toEqual(["agent-2"]);
  });

  it("installs declared external skills after wake and reports their verdicts", async () => {
    const { service, calls } = makeHarness({
      ...LOADED,
      kit: kit({
        skills: [
          {
            source: "https://github.com/acme/skills",
            name: "typescript-engineering",
          },
          {
            source: "https://github.com/acme/skills",
            name: "react-ui-engineering",
          },
        ],
      }),
    });
    const result = await service.apply({
      catalog: "platform",
      kitId: "code-reviewer",
      name: "reviewer",
      templateId: "claude-code",
      connectionIds: ["c-gh"],
      skipSchedules: [],
      scheduleOverrides: [],
    });
    expect(calls.woken).toEqual(["agent-1"]);
    expect(calls.skillEntries).toEqual([
      {
        agentId: "agent-1",
        skills: [
          {
            source: "https://github.com/acme/skills",
            name: "typescript-engineering",
          },
          {
            source: "https://github.com/acme/skills",
            name: "react-ui-engineering",
          },
        ],
      },
    ]);
    expect(result.skills?.added).toBe(1);
    expect(result.skills?.skipped.map((e) => e.reason)).toEqual([
      "source-not-connected",
    ]);
    expect(result.skillsError).toBeNull();
  });

  it("keeps the agent and reports when external skills cannot be installed", async () => {
    const deleted: string[] = [];
    const service = createStarterKitsService({
      owner: "user-1",
      createKnowledgeBaseAgent: async (input) =>
        fakeAgent("agent-1", { starterKit: input.starterKit }),
      repo: {
        list: async () => [],
        get: async () => ({
          ...LOADED,
          kit: kit({
            skills: [{ source: "https://github.com/acme/skills", name: "x" }],
          }),
        }),
      },
      agents: {
        create: async (input) =>
          fakeAgent("agent-3", { starterKit: input.starterKit }),
        delete: async (id) => {
          deleted.push(id);
        },
        get: async () => null,
        connectSlack: async () => ({}) as never,
      },
      schedules: {
        createCron: async (input) =>
          ({ id: "s1", name: input.name }) as Schedule,
        createRRule: async (input) =>
          ({ id: "s2", name: input.name }) as Schedule,
        toggle: async () => null,
        list: async () => [],
      },
      connections: {
        listConnections: async () => [connection("c-gh", "github-app")],
        listTemplates: async () => TEMPLATES,
        getAgentConnections: async (agentId: string) => ({
          agentId,
          connections: [],
        }),
      },
      skills: {
        applyEntries: async () => {
          throw new Error("agent never became reachable");
        },
      },
      wakeAgent: async () => {},
      markAgentOnboarded: async () => {},
      markAgentGreeted: async () => {},
    });
    const result = await service.apply({
      catalog: "platform",
      kitId: "code-reviewer",
      name: "r",
      templateId: "t",
      connectionIds: ["c-gh"],
      skipSchedules: [],
      scheduleOverrides: [],
    });
    expect(result.agent.id).toBe("agent-3");
    expect(result.skillsError).toBe("agent never became reachable");
    expect(deleted).toEqual([]);
  });

  it("returns NOT_FOUND for an unknown kit", async () => {
    const { service } = makeHarness(null);
    await expect(
      service.apply({
        catalog: "platform",
        kitId: "nope",
        name: "r",
        templateId: "t",
        connectionIds: [],
        skipSchedules: [],
        scheduleOverrides: [],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("starter kits: onboarding prompt", () => {
  it("is null for an agent not created from a kit", async () => {
    const { service } = makeHarness(LOADED, fakeAgent("agent-9"));
    expect(await service.onboardingPrompt("agent-9")).toBeNull();
  });

  it("is handed out once — a second caller gets nothing", async () => {
    const agent = fakeAgent("agent-1", {
      starterKit: "platform/code-reviewer@abc123",
    });
    const { service, calls } = makeHarness(LOADED, agent);
    expect(await service.onboardingPrompt("agent-1")).toContain(
      "code-reviewer",
    );
    expect(calls.greeted.map((g) => g.id)).toEqual(["agent-1"]);
    agent.starterKitGreeted = calls.greeted[0].at;
    expect(await service.onboardingPrompt("agent-1")).toBeNull();
    expect(calls.greeted).toHaveLength(1);
  });

  it("is null once the agent has finished onboarding", async () => {
    const { service } = makeHarness(
      LOADED,
      fakeAgent("agent-1", {
        starterKit: "platform/code-reviewer@abc123",
        starterKitOnboarded: "2026-09-15T00:00:00Z",
      }),
    );
    expect(await service.onboardingPrompt("agent-1")).toBeNull();
  });

  it("states what the platform set up and points at ONBOARDING.md", async () => {
    const { service } = makeHarness(
      LOADED,
      fakeAgent("agent-1", { starterKit: "platform/code-reviewer@abc123" }),
      [{ connectionId: "c-gh", grantedAt: "2026-09-14T00:00:00Z" }],
    );
    const prompt = await service.onboardingPrompt("agent-1");
    expect(prompt).toContain(
      '"Code reviewer" starter kit (platform/code-reviewer@abc123)',
    );
    expect(prompt).toContain(
      "https://github.com/acme/code-guardian at ref v1.4.0",
    );
    expect(prompt).toContain(
      "Connection (required, connected): github-app or github-pat",
    );
    expect(prompt).toContain('Schedule "benchmark": disabled');
    expect(prompt).toContain("repository to review (required)");
    expect(prompt).toContain("follow ONBOARDING.md");
  });

  it("reports a suggested connection the user never granted as NOT connected", async () => {
    const { service } = makeHarness(
      LOADED,
      fakeAgent("agent-1", { starterKit: "platform/code-reviewer@abc123" }),
      [{ connectionId: "c-gh", grantedAt: "2026-09-14T00:00:00Z" }],
    );
    const prompt = await service.onboardingPrompt("agent-1");
    expect(prompt).toContain("Connection (suggested, NOT connected): slack");
  });

  it("drops a granted connection the user has since deleted", async () => {
    const { service } = makeHarness(
      LOADED,
      fakeAgent("agent-1", { starterKit: "platform/code-reviewer@abc123" }),
      [{ connectionId: "c-gone", grantedAt: "2026-09-14T00:00:00Z" }],
    );
    const prompt = await service.onboardingPrompt("agent-1");
    expect(prompt).toContain(
      "Connection (required, NOT connected): github-app or github-pat",
    );
  });

  it("holds schedules until the agent marks onboarding complete", async () => {
    const { service, calls } = makeHarness(
      LOADED,
      fakeAgent("agent-1", { starterKit: "platform/code-reviewer@abc123" }),
    );
    const prompt = await service.onboardingPrompt("agent-1");
    expect(prompt).toContain("mark_onboarding_complete");

    await service.markOnboarded("agent-1");
    expect(calls.onboarded.map((o) => o.id)).toEqual(["agent-1"]);
    expect(calls.onboarded[0]!.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("refuses to mark an agent that came from no kit, and is idempotent", async () => {
    const plain = makeHarness(LOADED, fakeAgent("agent-9"));
    await expect(plain.service.markOnboarded("agent-9")).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });

    const already = makeHarness(
      LOADED,
      fakeAgent("agent-1", {
        starterKit: "platform/code-reviewer@abc123",
        starterKitOnboarded: "2026-09-14T09:00:00.000Z",
      }),
    );
    await already.service.markOnboarded("agent-1");
    expect(already.calls.onboarded).toEqual([]);
  });

  it("does not tell a seedless kit to follow a cloned definition", () => {
    const prompt = composeOnboardingPrompt({
      kit: kit({ seed: undefined }),
      catalog: "platform",
      version: "v1",
      granted: [],
      schedules: [],
      boundChannels: [],
      familyTitles: new Map(),
    });
    expect(prompt).toContain("This kit ships no definition repository.");
    expect(prompt).not.toContain("ONBOARDING.md");
    expect(prompt).not.toContain("cloned definition");
  });

  it("uses the kit's prompt as the instruction when one is declared", () => {
    const prompt = composeOnboardingPrompt({
      kit: kit({ onboarding: { prompt: "Run /setup." } }),
      catalog: "platform",
      version: "v1",
      granted: [],
      schedules: [],
      boundChannels: ["slack"],
      familyTitles: new Map(),
    });
    expect(prompt).toContain("Run /setup.");
    expect(prompt).not.toContain("ONBOARDING.md");
    expect(prompt).toContain("Channels bound: slack");
  });
});

describe("starter kits: domain helpers", () => {
  it("finds required connections no granted template satisfies", () => {
    const unmet = unmetRequiredConnections(kit(), [{ templateId: "slack" }]);
    expect(unmet.map((u) => u.accepts)).toEqual([["github-app", "github-pat"]]);
    expect(
      unmetRequiredConnections(kit(), [{ templateId: "github-pat" }]),
    ).toEqual([]);
  });

  it("accepts a granted template by its own id or by its family", () => {
    const familyKit = kit({
      connections: [{ accepts: ["github"], required: true }],
    });
    expect(
      unmetRequiredConnections(familyKit, [
        { templateId: "github-app", familyId: "github" },
      ]),
    ).toEqual([]);
    expect(
      unmetRequiredConnections(familyKit, [
        { templateId: "github-enterprise-pat", familyId: "github-enterprise" },
      ]),
    ).toHaveLength(1);
    expect(
      unmetRequiredConnections(familyKit, [{ templateId: "slack" }]),
    ).toHaveLength(1);
  });

  it("parses kit refs", () => {
    expect(parseKitRef("platform/code-reviewer@abc")).toEqual({
      catalog: "platform",
      kitId: "code-reviewer",
      version: "abc",
    });
    expect(parseKitRef("code-reviewer@abc")).toBeNull();
    expect(parseKitRef("broken")).toBeNull();
    expect(parseKitRef("platform/@v1")).toBeNull();
  });
});
