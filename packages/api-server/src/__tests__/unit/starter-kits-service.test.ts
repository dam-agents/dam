import { describe, expect, it } from "vitest";
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

function makeHarness(loaded: LoadedKit | null, agent: Agent | null = null) {
  const calls = {
    created: [] as AgentCreateInput[],
    deleted: [] as string[],
    woken: [] as string[],
    cron: [] as { name: string; agentId: string; cron: string }[],
    rrule: [] as { name: string; rrule: string; timezone: string }[],
    toggled: [] as string[],
    slack: [] as { agentId: string; channel: string; ambient?: boolean }[],
    skillEntries: [] as { agentId: string; skills: unknown[] }[],
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
  });
  return { service, calls };
}

const LOADED: LoadedKit = {
  kit: kit(),
  catalog: "platform",
  version: "abc123",
  source: "/catalog",
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

  it("leaves out the schedules the user chose to skip", async () => {
    const { service, calls } = makeHarness(LOADED);
    await service.apply({
      catalog: "platform",
      kitId: "code-reviewer",
      name: "reviewer",
      templateId: "claude-code",
      connectionIds: ["c-gh"],
      skipSchedules: ["benchmark"],
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
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const pinned = makeHarness({
      ...LOADED,
      kit: kit({
        image: { ref: "quay.io/acme/nous:1.0.0", size: { memory: "8Gi" } },
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
    });
    expect(pinned.calls.created[0].templateId).toBeUndefined();
    expect(pinned.calls.created[0].image).toBe("quay.io/acme/nous:1.0.0");
    expect(pinned.calls.created[0].size).toEqual({ memory: "8Gi" });
  });

  it("deletes the agent when seeding fails after create", async () => {
    const { service, calls } = makeHarness(LOADED);
    const failing = createStarterKitsService({
      owner: "user-1",
      repo: { list: async () => [LOADED], get: async () => LOADED },
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
      },
      skills: {
        applyEntries: async () => ({ installed: [], added: 0, skipped: [] }),
      },
      wakeAgent: async () => {},
    });
    await expect(
      failing.apply({
        catalog: "platform",
        kitId: "code-reviewer",
        name: "r",
        templateId: "t",
        connectionIds: ["c-gh"],
        skipSchedules: [],
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
      },
      skills: {
        applyEntries: async () => {
          throw new Error("agent never became reachable");
        },
      },
      wakeAgent: async () => {},
    });
    const result = await service.apply({
      catalog: "platform",
      kitId: "code-reviewer",
      name: "r",
      templateId: "t",
      connectionIds: ["c-gh"],
      skipSchedules: [],
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
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("starter kits: onboarding prompt", () => {
  it("is null for an agent not created from a kit", async () => {
    const { service } = makeHarness(LOADED, fakeAgent("agent-9"));
    expect(await service.onboardingPrompt("agent-9")).toBeNull();
  });

  it("states what the platform set up and points at ONBOARDING.md", async () => {
    const { service } = makeHarness(
      LOADED,
      fakeAgent("agent-1", { starterKit: "platform/code-reviewer@abc123" }),
    );
    const prompt = await service.onboardingPrompt("agent-1");
    expect(prompt).toContain(
      '"Code reviewer" starter kit (platform/code-reviewer@abc123)',
    );
    expect(prompt).toContain(
      "https://github.com/acme/code-guardian at ref v1.4.0",
    );
    expect(prompt).toContain(
      "Connection (required, granted at create): github-app or github-pat",
    );
    expect(prompt).toContain('Schedule "benchmark": disabled');
    expect(prompt).toContain("repository to review (required)");
    expect(prompt).toContain("follow ONBOARDING.md");
  });

  it("uses the kit's prompt as the instruction when one is declared", () => {
    const prompt = composeOnboardingPrompt({
      kit: kit({ onboarding: { prompt: "Run /setup." } }),
      catalog: "platform",
      version: "v1",
      schedules: [],
      boundChannels: ["slack"],
      familyTitles: new Map(),
    });
    expect(prompt.endsWith("Run /setup.")).toBe(true);
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
