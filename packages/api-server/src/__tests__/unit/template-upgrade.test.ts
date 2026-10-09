import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import type { TemplateSpec } from "api-server-api";
import { configureLogger } from "../../core/logger.js";
import { templateImageUpdate } from "../../modules/agents/domain/template-update.js";
import { executeTemplateUpgrade } from "../../modules/agents/services/agents-service.js";
import type { InfraAgent } from "../../modules/agents/infrastructure/agent-mappers.js";
import { createTemplatesRepository } from "../../modules/templates/infrastructure/templates-repository.js";

configureLogger({ level: "error", write: () => {} });

const OWNER = "kc|owner-1";

function infraAgent(overrides?: Partial<InfraAgent>): InfraAgent {
  return {
    id: "agent-1",
    name: "my-agent",
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

function templateSpec(
  image: string,
  extra?: Partial<TemplateSpec>,
): TemplateSpec {
  return {
    version: "agent-platform.ai/v1",
    image,
    category: "harness",
    ...extra,
  };
}

function harness(opts?: {
  agent?: InfraAgent | null;
  templateImage?: string | null;
  template?: Partial<TemplateSpec>;
}) {
  const agent = opts?.agent === undefined ? infraAgent() : opts.agent;
  const patchSpec = vi.fn(
    async (_id: string, patch: { image: string; harness?: string }) =>
      agent ? { ...agent, spec: { ...agent.spec, ...patch } } : null,
  );
  const run = executeTemplateUpgrade({
    owner: OWNER,
    getAgent: async () => agent,
    readTemplateSpec: async () =>
      opts?.templateImage === null
        ? null
        : {
            spec: templateSpec(
              opts?.templateImage ?? "quay.io/dam-agents/claude-code:0.2.8",
              opts?.template,
            ),
          },
    patchSpec,
  });
  return { run, patchSpec };
}

describe("templateImageUpdate", () => {
  it("reports the image movement when the template moved on", () => {
    expect(templateImageUpdate("repo:0.2.7", "repo:0.2.8")).toEqual({
      fromImage: "repo:0.2.7",
      toImage: "repo:0.2.8",
    });
  });

  it("is absent when the agent is current", () => {
    expect(templateImageUpdate("repo:0.2.8", "repo:0.2.8")).toBeUndefined();
  });

  it("is absent when the agent has no image captured", () => {
    expect(templateImageUpdate(undefined, "repo:0.2.8")).toBeUndefined();
  });
});

describe("template upgrade flow", () => {
  it("patches the agent onto the template's current image", async () => {
    const h = harness();
    const res = await h.run("agent-1");
    expect(h.patchSpec).toHaveBeenCalledWith("agent-1", {
      image: "quay.io/dam-agents/claude-code:0.2.8",
      harness: "claude-code",
    });
    expect(res.ok && res.value.spec.image).toBe(
      "quay.io/dam-agents/claude-code:0.2.8",
    );
  });

  it("preserves a legacy harness when the default template names none", async () => {
    const h = harness({
      agent: infraAgent({
        templateId: "codex",
        spec: {
          name: "my-agent",
          image: "quay.io/dam-agents/codex:0.2.7",
        },
      }),
      templateImage: "quay.io/dam-agents/default:1",
      template: {},
    });
    await h.run("agent-1");
    expect(h.patchSpec).toHaveBeenCalledWith("agent-1", {
      image: "quay.io/dam-agents/default:1",
      harness: "codex",
    });
  });

  it("preserves an explicit harness over the old template id and new default", async () => {
    const h = harness({
      agent: infraAgent({
        templateId: "codex",
        spec: { name: "my-agent", image: "repo:old", harness: "pi" },
      }),
      templateImage: "repo:new",
      template: { harness: "claude-code" },
    });
    await h.run("agent-1");
    expect(h.patchSpec).toHaveBeenCalledWith("agent-1", {
      image: "repo:new",
      harness: "pi",
    });
  });

  it.each([
    ["claude-code", "claude-code"],
    ["codex", "codex"],
    ["pi-agent", "pi"],
    ["bob", "bob"],
  ])(
    "upgrades retained %s templates to the coding image and keeps %s",
    async (templateId, chosenHarness) => {
      const dir = mkdtempSync(join(tmpdir(), "template-upgrade-"));
      try {
        writeFileSync(
          join(dir, "default.yaml"),
          JSON.stringify(
            templateSpec("repo:coding", {
              aliases: ["claude-code", "codex", "pi-agent", "bob"],
            }),
          ),
        );
        writeFileSync(
          join(dir, `${templateId}.yaml`),
          JSON.stringify(templateSpec("repo:legacy")),
        );
        writeFileSync(
          join(dir, "workload.yaml"),
          JSON.stringify(templateSpec("repo:workload")),
        );
        const templates = createTemplatesRepository(dir);
        const agent = infraAgent({
          templateId,
          spec: { name: "my-agent", image: "repo:old" },
        });
        const patchSpec = vi.fn(
          async (_id: string, patch: { image: string; harness?: string }) => ({
            ...agent,
            spec: { ...agent.spec, ...patch },
          }),
        );
        const run = executeTemplateUpgrade({
          owner: OWNER,
          getAgent: async () => agent,
          readTemplateSpec: templates.readSpec,
          patchSpec,
        });
        expect((await templates.get(templateId))?.id).toBe("default");
        expect((await templates.list()).map((t) => t.id).sort()).toEqual([
          "default",
          "workload",
        ]);
        expect((await templates.readSpec("workload"))?.spec.image).toBe(
          "repo:workload",
        );
        expect((await run("agent-1", "repo:coding")).ok).toBe(true);
        expect(patchSpec).toHaveBeenCalledWith("agent-1", {
          image: "repo:coding",
          harness: chosenHarness,
        });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it("succeeds without patching when already current (idempotent)", async () => {
    const h = harness({
      templateImage: "quay.io/dam-agents/claude-code:0.2.7",
    });
    const res = await h.run("agent-1");
    expect(res.ok && res.value.spec.image).toBe(
      "quay.io/dam-agents/claude-code:0.2.7",
    );
    expect(h.patchSpec).not.toHaveBeenCalled();
  });

  it("rejects an unknown or unowned agent", async () => {
    const h = harness({ agent: null });
    expect(await h.run("agent-1")).toEqual({
      ok: false,
      error: { type: "AgentNotFound" },
    });
  });

  it("rejects a bare-image agent (no template to upgrade from)", async () => {
    const h = harness({ agent: infraAgent({ templateId: undefined }) });
    expect(await h.run("agent-1")).toEqual({
      ok: false,
      error: { type: "TemplateNotFound" },
    });
    expect(h.patchSpec).not.toHaveBeenCalled();
  });

  it("rejects when the template is no longer installed", async () => {
    const h = harness({ templateImage: null });
    expect(await h.run("agent-1")).toEqual({
      ok: false,
      error: { type: "TemplateNotFound" },
    });
    expect(h.patchSpec).not.toHaveBeenCalled();
  });

  it("maps a patch-time disappearance to AgentNotFound", async () => {
    const h = harness();
    h.patchSpec.mockResolvedValueOnce(null);
    expect(await h.run("agent-1")).toEqual({
      ok: false,
      error: { type: "AgentNotFound" },
    });
  });

  it("applies when the template still ships the confirmed image", async () => {
    const h = harness();
    const res = await h.run("agent-1", "quay.io/dam-agents/claude-code:0.2.8");
    expect(res.ok && res.value.spec.image).toBe(
      "quay.io/dam-agents/claude-code:0.2.8",
    );
  });

  it("rejects a confirmation for an image the template no longer ships", async () => {
    const h = harness({
      templateImage: "quay.io/dam-agents/claude-code:0.2.9",
    });
    expect(
      await h.run("agent-1", "quay.io/dam-agents/claude-code:0.2.8"),
    ).toEqual({
      ok: false,
      error: { type: "TemplateMoved" },
    });
    expect(h.patchSpec).not.toHaveBeenCalled();
  });
});
