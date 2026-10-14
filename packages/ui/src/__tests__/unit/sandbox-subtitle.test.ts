import { describe, expect, it } from "vitest";

import { sandboxSubtitle } from "../../modules/agents/utils/sandbox-subtitle.js";
import { findTemplate } from "../../modules/templates/lib/find-template.js";
import type { AgentView, TemplateView } from "../../types.js";

const template: TemplateView = {
  id: "default",
  name: "Coding agent",
  aliases: ["claude-code", "codex", "pi-agent", "bob"],
  image: "registry.example/agents/default:new",
  category: "harness",
  experimental: false,
};

const agent: AgentView = {
  id: "agent",
  name: "Code Guardian",
  avatar: null,
  templateId: "claude-code",
  templateUpdate: null,
  features: { liveUpdates: true },
  kbTemplateId: null,
  starterKit: null,
  starterKitOnboarded: null,
  image: "registry.example/agents/default:old",
  hibernationTimeoutMin: 60,
  requireConnectionAddress: false,
  grantedSecretIds: [],
  grantedConnectionIds: ["provider"],
  stopRequested: false,
  overBudget: false,
  size: {},
  state: "hibernated",
  podRestarts: 0,
  contributionFailures: [],
  unsupportedContributionKinds: [],
  workspaceFailures: [],
  channels: [],
  spawnedBy: null,
  vm: false,
  runtimeMigration: null,
  runtimeMigratable: false,
};

const slotUnit = { cpuMilli: 1000, memoryMi: 1024 };

describe("agent card subtitle", () => {
  const sized = { ...agent, size: { cpu: "2", memory: "2Gi" } };

  it("names the resource class of a container agent, never its provider", () => {
    expect(sandboxSubtitle(sized, slotUnit)).not.toMatch(/LiteLLM/);
    expect(sandboxSubtitle(sized, slotUnit)).toBeTruthy();
  });

  it("shows a vm agent's own share of its pools, and nothing it has not measured", () => {
    const vmAgent = { ...sized, vm: true, state: "running" as const };
    const usage = {
      memory: { usedBytes: 0, limitBytes: 0, level: "ok" as const },
      storage: { usedBytes: 0, usableBytes: 0, level: "ok" as const },
      agents: [
        {
          id: "agent",
          memoryUsedBytes: 1.5 * 1024 ** 3,
          storageUsedBytes: 8 * 1024 ** 3,
          cpuMilli: 0,
        },
      ],
      observedAt: "",
    };
    expect(sandboxSubtitle(vmAgent, slotUnit, usage)).toBe(
      "using 1.5 GiB memory · 8.0 GiB storage",
    );
    expect(sandboxSubtitle(vmAgent, slotUnit)).toBeNull();
  });
});

describe("findTemplate", () => {
  it.each(["default", "claude-code", "codex", "pi-agent", "bob"])(
    "resolves %s, an id or an alias of an older image",
    (templateId) => {
      expect(findTemplate([template], templateId)).toBe(template);
    },
  );

  it.each([null, "unknown"])("finds nothing for template %s", (templateId) => {
    expect(findTemplate([template], templateId)).toBeUndefined();
  });

  it("prefers a real template id over an alias regardless of list order", () => {
    const custom: TemplateView = {
      ...template,
      id: "claude-code",
      name: "Custom Claude",
      aliases: undefined,
    };
    for (const templates of [
      [template, custom],
      [custom, template],
    ]) {
      expect(findTemplate(templates, "claude-code")).toBe(custom);
    }
  });
});
