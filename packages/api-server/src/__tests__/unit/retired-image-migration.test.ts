// TEST_OVERVIEW: the platform moves Agents left on a retired per-harness
// TEST_OVERVIEW: image to the default image by itself. It picks only hibernated
// TEST_OVERVIEW: or over-budget container Agents on one of the four retired
// TEST_OVERVIEW: images, carries their harness over the way the UI's Update
// TEST_OVERVIEW: does, and writes against the version it decided from.
import { describe, it, expect, vi } from "vitest";
import type { TemplateSpec } from "api-server-api";
import { configureLogger } from "../../core/logger.js";
import type { InfraAgent } from "../../modules/agents/infrastructure/agent-mappers.js";
import type { RuntimeMigrationWrite } from "../../modules/agents/infrastructure/agents-repository.js";
import {
  createRetiredImageMigration,
  migratesToDefault,
} from "../../modules/agents/services/retired-image-migration.js";

configureLogger({ level: "error", write: () => {} });

const DEFAULT_IMAGE = "quay.io/dam-agents/default:abc";

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

function migration(agents: InfraAgent[]) {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const writeSpec = vi.fn(async (id: string, write: RuntimeMigrationWrite) => {
    const a = byId.get(id)!;
    return {
      ok: true as const,
      value: { ...a, spec: { ...a.spec, ...write.spec } },
    };
  });
  const tick = createRetiredImageMigration({
    listAgents: async () => agents,
    getAgent: async (id) => byId.get(id) ?? null,
    readTemplateSpec: async () => defaultTemplate(),
    writeSpec,
    log: () => {},
  }).tick;
  return { tick, writeSpec };
}

describe("migratesToDefault", () => {
  it.each([
    "quay.io/dam-agents/claude-code:0.2.7",
    "quay.io/dam-agents/codex:15f7ab51",
    "quay.io/dam-agents/pi-agent:0.2.13-dev-b98679",
    "quay.io/dam-agents/bob@sha256:0123",
  ])("selects a hibernated agent on %s", (image) => {
    expect(
      migratesToDefault(agent({ spec: { name: "a", image } }), DEFAULT_IMAGE),
    ).toBe(true);
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
    expect(
      migratesToDefault(agent({ spec: { name: "a", image } }), DEFAULT_IMAGE),
    ).toBe(false);
  });

  it("follows a default image mirrored to another registry", () => {
    expect(
      migratesToDefault(
        agent({ spec: { name: "a", image: "mirror:5000/dam/codex:1" } }),
        "mirror:5000/dam/default:2",
      ),
    ).toBe(true);
  });

  it("selects an over-budget agent, which no restart serves", () => {
    expect(
      migratesToDefault(
        agent({ hibernated: false, overBudget: true }),
        DEFAULT_IMAGE,
      ),
    ).toBe(true);
  });

  // TEST_SCENARIO: an image change restarts a running agent and interrupts
  // TEST_SCENARIO: its turn, so a running agent waits until it hibernates.
  it("waits for a running agent to hibernate", () => {
    expect(
      migratesToDefault(
        agent({ hibernated: false, ready: true }),
        DEFAULT_IMAGE,
      ),
    ).toBe(false);
  });

  it("leaves a vm agent alone, whose root an image change can discard", () => {
    expect(
      migratesToDefault(
        agent({
          spec: {
            name: "a",
            image: "quay.io/dam-agents/bob:1",
            backend: { type: "vm" },
          },
        }),
        DEFAULT_IMAGE,
      ),
    ).toBe(false);
  });

  it("leaves an agent with a storage migration under way alone", () => {
    expect(
      migratesToDefault(agent({ storageMigrating: true }), DEFAULT_IMAGE),
    ).toBe(false);
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

  it("skips running, vm and workload agents", async () => {
    const m = migration([
      agent({ id: "running", hibernated: false, ready: true }),
      agent({
        id: "vm",
        spec: {
          name: "a",
          image: "quay.io/dam-agents/codex:1",
          backend: { type: "vm" },
        },
      }),
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
    const listed = agent();
    const woke = agent({ hibernated: false, ready: true });
    const writeSpec = vi.fn();
    await createRetiredImageMigration({
      listAgents: async () => [listed],
      getAgent: async () => woke,
      readTemplateSpec: async () => defaultTemplate(),
      writeSpec,
      log: () => {},
    }).tick();
    expect(writeSpec).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: an agent on a retired image whose template resolves to
  // TEST_SCENARIO: something other than the default Template is not moved.
  it("refuses an agent whose template is not the default", async () => {
    const writeSpec = vi.fn();
    const log = vi.fn();
    await createRetiredImageMigration({
      listAgents: async () => [agent({ templateId: "custom" })],
      getAgent: async () => agent({ templateId: "custom" }),
      readTemplateSpec: async (id) =>
        id === "custom"
          ? { spec: { ...defaultTemplate().spec, image: "repo:custom" } }
          : defaultTemplate(),
      writeSpec,
      log,
    }).tick();
    expect(writeSpec).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      "[retired-image-migration] agent-1 refused: TemplateMoved",
    );
  });

  it("does nothing without a default template", async () => {
    const writeSpec = vi.fn();
    await createRetiredImageMigration({
      listAgents: async () => [agent()],
      getAgent: async () => agent(),
      readTemplateSpec: async () => null,
      writeSpec,
      log: () => {},
    }).tick();
    expect(writeSpec).not.toHaveBeenCalled();
  });
});
