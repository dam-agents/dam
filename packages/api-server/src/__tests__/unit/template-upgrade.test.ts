import { describe, it, expect, vi } from "vitest";
import type { TemplateSpec } from "api-server-api";
import { configureLogger } from "../../core/logger.js";
import { templateImageUpdate } from "../../modules/agents/domain/template-update.js";
import { executeTemplateUpgrade } from "../../modules/agents/services/agents-service.js";
import type { InfraAgent } from "../../modules/agents/infrastructure/agent-mappers.js";

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

function templateSpec(image: string): TemplateSpec {
  return { version: "agent-platform.ai/v1", image, category: "harness" };
}

function harness(opts?: {
  agent?: InfraAgent | null;
  templateImage?: string | null;
}) {
  const agent = opts?.agent === undefined ? infraAgent() : opts.agent;
  const patchImage = vi.fn(async (_id: string, image: string) =>
    agent ? { ...agent, spec: { ...agent.spec, image } } : null,
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
            ),
            isOwned: false,
          },
    patchImage,
  });
  return { run, patchImage };
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
    expect(h.patchImage).toHaveBeenCalledWith(
      "agent-1",
      "quay.io/dam-agents/claude-code:0.2.8",
    );
    expect(res.ok && res.value.spec.image).toBe(
      "quay.io/dam-agents/claude-code:0.2.8",
    );
  });

  it("succeeds without patching when already current (idempotent)", async () => {
    const h = harness({
      templateImage: "quay.io/dam-agents/claude-code:0.2.7",
    });
    const res = await h.run("agent-1");
    expect(res.ok && res.value.spec.image).toBe(
      "quay.io/dam-agents/claude-code:0.2.7",
    );
    expect(h.patchImage).not.toHaveBeenCalled();
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
    expect(h.patchImage).not.toHaveBeenCalled();
  });

  it("rejects when the template is no longer installed", async () => {
    const h = harness({ templateImage: null });
    expect(await h.run("agent-1")).toEqual({
      ok: false,
      error: { type: "TemplateNotFound" },
    });
    expect(h.patchImage).not.toHaveBeenCalled();
  });

  it("maps a patch-time disappearance to AgentNotFound", async () => {
    const h = harness();
    h.patchImage.mockResolvedValueOnce(null);
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
    expect(h.patchImage).not.toHaveBeenCalled();
  });
});
