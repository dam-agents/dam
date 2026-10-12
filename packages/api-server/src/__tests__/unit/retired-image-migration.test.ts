// TEST_OVERVIEW: the platform moves Agents left on a retired per-harness
// TEST_OVERVIEW: image to the default image by itself. It picks only Agents
// TEST_OVERVIEW: on one of the four retired images, container or vm. A down
// TEST_OVERVIEW: Agent moves at once; an always-on Agent moves only when every
// TEST_OVERVIEW: idle signal agrees; any other running Agent waits to
// TEST_OVERVIEW: hibernate. The harness carries over the way the UI's Update
// TEST_OVERVIEW: does, and the write names the version it decided from.
import { describe, it, expect, vi } from "vitest";
import type { TemplateSpec } from "api-server-api";
import { configureLogger } from "../../core/logger.js";
import {
  parseInfraAgent,
  type InfraAgent,
} from "../../modules/agents/infrastructure/agent-mappers.js";
import type { RuntimeMigrationWrite } from "../../modules/agents/infrastructure/agents-repository.js";
import {
  createRetiredImageMigration,
  retiredImageMove,
} from "../../modules/agents/services/retired-image-migration.js";

configureLogger({ level: "error", write: () => {} });

const DEFAULT_IMAGE = "quay.io/dam-agents/default:abc";
const NOW = new Date("2026-10-12T12:00:00Z");
const TWO_HOURS_AGO = new Date("2026-10-12T10:00:00Z");
const GLOBAL_IDLE_MIN = 60;

function agent(overrides?: Partial<InfraAgent>): InfraAgent {
  return {
    id: "agent-1",
    name: "my-agent",
    resourceVersion: "7",
    templateId: "claude-code",
    spec: { name: "my-agent", image: "quay.io/dam-agents/claude-code:0.2.7" },
    sweepable: false,
    lifetimeMs: 0,
    ready: false,
    hibernated: true,
    stopRequested: false,
    overBudget: false,
    podRestarts: 0,
    ...overrides,
  };
}

function alwaysOn(overrides?: Partial<InfraAgent>): InfraAgent {
  return agent({
    hibernated: false,
    ready: true,
    quietSince: TWO_HOURS_AGO,
    spec: {
      name: "my-agent",
      image: "quay.io/dam-agents/claude-code:0.2.7",
      hibernationTimeout: "0s",
    },
    ...overrides,
  });
}

function defaultTemplate(): { spec: TemplateSpec } {
  return {
    spec: {
      version: "agent-platform.ai/v1",
      image: DEFAULT_IMAGE,
      category: "harness",
      aliases: ["claude-code", "codex", "pi-agent", "bob"],
    },
  };
}

function move(a: InfraAgent, defaultImage = DEFAULT_IMAGE) {
  return retiredImageMove(a, defaultImage, GLOBAL_IDLE_MIN, NOW);
}

function migration(
  agents: InfraAgent[],
  opts?: {
    live?: (id: string) => InfraAgent | null;
    podIsIdle?: () => Promise<boolean>;
    readTemplateSpec?: (id: string) => Promise<{ spec: TemplateSpec } | null>;
  },
) {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const writeSpec = vi.fn(async (id: string, write: RuntimeMigrationWrite) => {
    const a = byId.get(id)!;
    return {
      ok: true as const,
      value: { ...a, spec: { ...a.spec, ...write.spec } },
    };
  });
  const log = vi.fn();
  const podIsIdle = vi.fn(opts?.podIsIdle ?? (async () => true));
  const tick = createRetiredImageMigration({
    listAgents: async () => agents,
    getAgent: async (id) =>
      opts?.live ? opts.live(id) : (byId.get(id) ?? null),
    readTemplateSpec: opts?.readTemplateSpec ?? (async () => defaultTemplate()),
    writeSpec,
    podIsIdle,
    globalIdleTimeoutMin: GLOBAL_IDLE_MIN,
    log,
  }).tick;
  return { tick, writeSpec, podIsIdle, log };
}

describe("retiredImageMove", () => {
  it.each([
    "quay.io/dam-agents/claude-code:0.2.7",
    "quay.io/dam-agents/codex:15f7ab51",
    "quay.io/dam-agents/pi-agent:0.2.13-dev-b98679",
    "quay.io/dam-agents/bob@sha256:0123",
  ])("moves a hibernated agent on %s now", (image) => {
    expect(move(agent({ spec: { name: "a", image } }))).toBe("now");
  });

  // TEST_SCENARIO: starter-kit workload images and custom images share the
  // TEST_SCENARIO: registry or the harness name, and must never be moved.
  it.each([
    "quay.io/dam-agents/default:old",
    "quay.io/dam-agents/nous:0.2.6",
    "quay.io/someone/claude-code:1",
    "quay.io/dam-agents/claude-code-fork:1",
    "us.icr.io/team/bob:1",
  ])("leaves an agent on %s alone", (image) => {
    expect(move(agent({ spec: { name: "a", image } }))).toBeNull();
  });

  it("follows a default image mirrored to another registry", () => {
    expect(
      move(
        agent({ spec: { name: "a", image: "mirror:5000/dam/codex:1" } }),
        "mirror:5000/dam/default:2",
      ),
    ).toBe("now");
  });

  it("moves an over-budget agent now, which no restart serves", () => {
    expect(move(agent({ hibernated: false, overBudget: true }))).toBe("now");
  });

  // TEST_SCENARIO: the vm-runner keeps a machine's root when the default
  // TEST_SCENARIO: image declares the same root generation, and the owner
  // TEST_SCENARIO: accepted a fresh root otherwise, so a vm agent moves too.
  it("moves a hibernated vm agent", () => {
    expect(
      move(
        agent({
          spec: {
            name: "a",
            image: "quay.io/dam-agents/bob:1",
            backend: { type: "vm" },
          },
        }),
      ),
    ).toBe("now");
  });

  // TEST_SCENARIO: an image change restarts a running agent, so an agent
  // TEST_SCENARIO: that hibernates by itself waits for the idle checker.
  it("waits for a running agent that hibernates to hibernate", () => {
    expect(
      move(
        agent({ hibernated: false, ready: true, quietSince: TWO_HOURS_AGO }),
      ),
    ).toBeNull();
  });

  it("moves a quiet always-on agent once its pod says idle", () => {
    expect(move(alwaysOn())).toBe("if-pod-idle");
  });

  it("treats every agent as always-on when the install never hibernates", () => {
    expect(
      retiredImageMove(
        agent({ hibernated: false, ready: true, quietSince: TWO_HOURS_AGO }),
        DEFAULT_IMAGE,
        0,
        NOW,
      ),
    ).toBe("if-pod-idle");
  });

  // TEST_SCENARIO: an open connection or an Invocation pin clears quietSince,
  // TEST_SCENARIO: and recent activity means the user may be back any moment.
  it.each([
    ["an open connection or pin", undefined],
    ["recent activity", new Date("2026-10-12T11:30:00Z")],
  ])("leaves an always-on agent with %s alone", (_, quietSince) => {
    expect(
      move(alwaysOn(quietSince ? { quietSince } : { quietSince: undefined })),
    ).toBeNull();
  });

  it("leaves an agent with a storage migration under way alone", () => {
    expect(move(agent({ storageMigrating: true }))).toBeNull();
  });
});

describe("retired image migration tick", () => {
  it.each([
    ["claude-code", "claude-code"],
    ["codex", "codex"],
    ["pi-agent", "pi"],
    ["bob", "bob"],
  ])(
    "moves a %s agent to the default image with harness %s",
    async (templateId, harness) => {
      const m = migration([
        agent({
          templateId,
          spec: { name: "a", image: `quay.io/dam-agents/${templateId}:old` },
        }),
      ]);
      await m.tick();
      expect(m.writeSpec).toHaveBeenCalledWith("agent-1", {
        spec: { image: DEFAULT_IMAGE, harness },
        annotations: {},
        resourceVersion: "7",
      });
    },
  );

  it("keeps a harness the agent already chose", async () => {
    const m = migration([
      agent({
        spec: {
          name: "a",
          image: "quay.io/dam-agents/claude-code:old",
          harness: "codex",
        },
      }),
    ]);
    await m.tick();
    expect(m.writeSpec.mock.calls[0]![1].spec).toEqual({
      image: DEFAULT_IMAGE,
      harness: "codex",
    });
  });

  it("does not probe a hibernated agent's pod", async () => {
    const m = migration([agent()]);
    await m.tick();
    expect(m.podIsIdle).not.toHaveBeenCalled();
    expect(m.writeSpec).toHaveBeenCalledOnce();
  });

  it("restarts a quiet always-on agent whose pod reports idle", async () => {
    const m = migration([alwaysOn()]);
    await m.tick();
    expect(m.podIsIdle).toHaveBeenCalledWith("agent-1");
    expect(m.writeSpec).toHaveBeenCalledOnce();
  });

  // TEST_SCENARIO: the pod's idle flag covers a running turn, queued prompts,
  // TEST_SCENARIO: an open terminal and kept background work; any of them
  // TEST_SCENARIO: keeps the agent where it is, and so does a failed probe.
  it.each([
    ["is busy", async () => false],
    ["cannot be reached", () => Promise.reject(new Error("refused"))],
  ])("leaves an always-on agent whose pod %s", async (_, podIsIdle) => {
    const m = migration([alwaysOn()], { podIsIdle });
    await m.tick();
    expect(m.writeSpec).not.toHaveBeenCalled();
  });

  it("skips running agents that hibernate and workload agents", async () => {
    const m = migration([
      agent({ id: "running", hibernated: false, ready: true }),
      agent({
        id: "kit",
        templateId: "nous",
        spec: { name: "a", image: "quay.io/dam-agents/nous:1" },
      }),
    ]);
    await m.tick();
    expect(m.writeSpec).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: the listing comes from a cache; an agent that woke since
  // TEST_SCENARIO: is running on the live read and must not be restarted.
  it("decides again on the live read", async () => {
    const m = migration([agent()], {
      live: () => agent({ hibernated: false, ready: true }),
    });
    await m.tick();
    expect(m.writeSpec).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: an agent on a retired image whose template resolves to
  // TEST_SCENARIO: something other than the default Template is not moved.
  it("refuses an agent whose template is not the default", async () => {
    const m = migration([agent({ templateId: "custom" })], {
      readTemplateSpec: async (id) =>
        id === "custom"
          ? { spec: { ...defaultTemplate().spec, image: "repo:custom" } }
          : defaultTemplate(),
    });
    await m.tick();
    expect(m.writeSpec).not.toHaveBeenCalled();
    expect(m.log).toHaveBeenCalledWith(
      "[retired-image-migration] agent-1 refused: TemplateMoved",
    );
  });

  it("does nothing without a default template", async () => {
    const m = migration([agent()], { readTemplateSpec: async () => null });
    await m.tick();
    expect(m.writeSpec).not.toHaveBeenCalled();
  });
});

describe("quietSince", () => {
  const parsed = (annotations: Record<string, string>) =>
    parseInfraAgent({
      metadata: { name: "agent-1", annotations },
      spec: { image: "quay.io/dam-agents/codex:1" },
    }).quietSince;
  const last = { "agent-platform.ai/last-activity": "2026-10-12T10:00:00Z" };

  it("is the last activity when nothing holds the agent", () => {
    expect(parsed(last)).toEqual(TWO_HOURS_AGO);
  });

  it.each([
    ["an open connection", "agent-platform.ai/active-session"],
    ["an Invocation pin", "agent-platform.ai/invocations-active"],
  ])("is absent under %s", (_, key) => {
    expect(parsed({ ...last, [key]: "true" })).toBeUndefined();
  });

  it("is absent without a readable activity stamp", () => {
    expect(
      parsed({ "agent-platform.ai/last-activity": "garbage" }),
    ).toBeUndefined();
  });
});
