// TEST_OVERVIEW: harness templates that declare the vm backend. They are left out of the catalog on an install without virtualization, and a driver's own harness is read from its spec, because every vm-only template shares one image.
import { describe, it, expect } from "vitest";
import type { Template, TemplatesService } from "api-server-api";
import { runnableTemplates } from "../../modules/templates/index.js";
import { createDriverOps } from "../../apps/harness-api-server/driver-ops.js";

const template = (id: string, extra?: Partial<Template["spec"]>): Template => ({
  id,
  name: id,
  spec: { version: "agent-platform.ai/v1", image: "default:1", ...extra },
});

const repo: TemplatesService = {
  list: async () => [
    template("claude-code", { backend: "vm", harness: "claude-code" }),
    template("codex", { backend: "vm", harness: "codex" }),
    template("plain"),
  ],
  get: async (id) => (await repo.list()).find((t) => t.id === id) ?? null,
};

describe("runnableTemplates", () => {
  // TEST_SCENARIO: an install without virtualization cannot run a vm-only template, so the catalog must not offer it and a read must say it is absent, like a vm Starter Kit.
  it("hides vm-only templates when virtualization is off", async () => {
    const visible = runnableTemplates(repo, false);
    expect((await visible.list()).map((t) => t.id)).toEqual(["plain"]);
    expect(await visible.get("codex")).toBeNull();
    expect((await visible.get("plain"))?.id).toBe("plain");
  });

  it("offers every template when virtualization is on", async () => {
    expect(await runnableTemplates(repo, true).list()).toHaveLength(3);
  });
});

describe("driver harness", () => {
  const harnessOf = (spec: { image: string; harness?: string }) =>
    createDriverOps({
      agents: { get: async () => ({ templateId: "claude-code", spec }) },
      templates: repo,
      invocationsServiceFor: () => ({}),
      connectionsServiceFor: () => ({}),
    } as unknown as Parameters<typeof createDriverOps>[0])({
      id: "driver-1",
      owner: "kc|owner-1",
    }).harness();

  // TEST_SCENARIO: all vm-only templates share one image and the template label can be stale after an upgrade, so the harness the Agent spec names is the one the machine runs.
  it("reads the harness from the agent spec first", async () => {
    expect(await harnessOf({ image: "default:1", harness: "codex" })).toBe(
      "codex",
    );
  });

  it("falls back to the agent's template when the spec names none", async () => {
    expect(await harnessOf({ image: "default:1" })).toBe("claude-code");
  });
});
