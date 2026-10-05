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

const spec = (image: string, backend?: "vm") => ({
  name: "a",
  image,
  ...(backend ? { backend: { type: backend } } : {}),
});

describe("templateImageUpdate", () => {
  it("reports the image movement when the template moved on", () => {
    expect(
      templateImageUpdate(spec("repo:0.2.7"), templateSpec("repo:0.2.8")),
    ).toEqual({
      fromImage: "repo:0.2.7",
      toImage: "repo:0.2.8",
    });
  });

  it("is absent when the agent is current", () => {
    expect(
      templateImageUpdate(spec("repo:0.2.8"), templateSpec("repo:0.2.8")),
    ).toBeUndefined();
  });

  it("is absent when the agent has no image captured", () => {
    expect(
      templateImageUpdate({ name: "a", image: "" }, templateSpec("repo:0.2.8")),
    ).toBeUndefined();
  });

  // TEST_SCENARIO: a vm-only template ships a bare image whose tools only a microVM mounts. A container agent would not boot on it, so it is not offered the upgrade until it migrates to the vm backend; after that it is.
  it("offers a vm-only template's image only to an agent already on the vm backend", () => {
    const vmOnly = templateSpec("default:1", { backend: "vm" });
    expect(
      templateImageUpdate(spec("claude-code:0.2.7"), vmOnly),
    ).toBeUndefined();
    expect(
      templateImageUpdate(spec("claude-code:0.2.7", "vm"), vmOnly),
    ).toEqual({
      fromImage: "claude-code:0.2.7",
      toImage: "default:1",
    });
  });
});

describe("template upgrade flow", () => {
  it("patches the agent onto the template's current image", async () => {
    const h = harness();
    const res = await h.run("agent-1");
    expect(h.patchSpec).toHaveBeenCalledWith("agent-1", {
      image: "quay.io/dam-agents/claude-code:0.2.8",
    });
    expect(res.ok && res.value.spec.image).toBe(
      "quay.io/dam-agents/claude-code:0.2.8",
    );
  });

  // TEST_SCENARIO: every vm-only template shares one image, so the image alone no longer says which harness runs. The upgrade must write the template's harness too, or an upgraded codex agent would boot as claude-code.
  it("writes the template's harness beside the new image", async () => {
    const h = harness({
      agent: infraAgent({
        templateId: "codex",
        spec: {
          name: "my-agent",
          image: "quay.io/dam-agents/codex:0.2.7",
          backend: { type: "vm" },
        },
      }),
      templateImage: "quay.io/dam-agents/default:1",
      template: { backend: "vm", harness: "codex" },
    });
    await h.run("agent-1");
    expect(h.patchSpec).toHaveBeenCalledWith("agent-1", {
      image: "quay.io/dam-agents/default:1",
      harness: "codex",
    });
  });

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
