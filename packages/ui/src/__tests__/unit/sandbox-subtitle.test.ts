import { describe, expect, it } from "vitest";

import {
  sandboxSubtitle,
  type SandboxSubtitleLookup,
  sandboxSubtitleParts,
} from "../../modules/agents/utils/sandbox-subtitle.js";
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

const lookup: SandboxSubtitleLookup = {
  templates: [template],
  slotUnit: { cpuMilli: 1000, memoryMi: 1024 },
};

describe("agent card subtitle", () => {
  const sized = { ...agent, size: { cpu: "2", memory: "2Gi" } };

  it("names the resource class of a container agent, never its provider", () => {
    expect(sandboxSubtitle(sized, lookup)).not.toMatch(/LiteLLM/);
    expect(sandboxSubtitle(sized, lookup)).toBeTruthy();
  });

  it("is empty for a vm agent", () => {
    expect(sandboxSubtitle({ ...sized, vm: true }, lookup)).toBeNull();
  });
});

describe("agent template display names", () => {
  it.each(["default", "claude-code", "codex", "pi-agent", "bob"])(
    "shows the name for %s even on an older image",
    (templateId) => {
      expect(
        sandboxSubtitleParts({ ...agent, templateId }, lookup).harness,
      ).toBe("Coding agent");
    },
  );

  it.each([null, "unknown"])(
    "keeps the image fallback for template %s",
    (templateId) => {
      expect(
        sandboxSubtitleParts({ ...agent, templateId }, lookup).harness,
      ).toBe(agent.image);
    },
  );

  it("keeps the image fallback while the catalogue is loading", () => {
    expect(
      sandboxSubtitleParts(agent, { ...lookup, templates: [] }).harness,
    ).toBe(agent.image);
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
      expect(
        sandboxSubtitleParts(agent, { ...lookup, templates }).harness,
      ).toBe("Custom Claude");
    }
  });
});
