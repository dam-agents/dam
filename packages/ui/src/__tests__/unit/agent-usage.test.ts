import { describe, expect, it } from "vitest";

import { agentUsage } from "../../modules/agents/utils/sandbox-subtitle.js";
import type { AgentView } from "../../types.js";

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
  whisper: true,
  grantedSecretIds: [],
  grantedConnectionIds: ["provider"],
  stopRequested: false,
  disabled: false,
  overBudget: false,
  size: {},
  state: "hibernated",
  podRestarts: 0,
  contributionFailures: [],
  unsupportedContributionKinds: [],
  workspaceFailures: [],
  channels: [],
  spawnedBy: null,
  environmentOf: null,
};

const usage = (memoryUsedBytes: number, storageUsedBytes: number) => ({
  memory: { usedBytes: 0, limitBytes: 0, level: "ok" as const },
  storage: {
    usedBytes: 0,
    usableBytes: 0,
    seedBytes: 0,
    level: "ok" as const,
  },
  agents: [{ id: "agent", memoryUsedBytes, storageUsedBytes, cpuMilli: 0 }],
  observedAt: "",
});

describe("agent usage", () => {
  // TEST_SCENARIO: an agent shows its own measured memory and storage as figures, and a figure not measured, zero, or a sleeping agent's memory is left out.
  it("shows an agent's own share of its pools, and nothing it has not measured", () => {
    const running = { ...agent, state: "running" as const };
    expect(agentUsage(running, usage(1.5 * 1024 ** 3, 8 * 1024 ** 3))).toEqual({
      memoryBytes: 1.5 * 1024 ** 3,
      storageBytes: 8 * 1024 ** 3,
    });
    expect(agentUsage(running, usage(0, 8 * 1024 ** 3))).toEqual({
      memoryBytes: null,
      storageBytes: 8 * 1024 ** 3,
    });
    expect(
      agentUsage(
        { ...running, state: "hibernated" },
        usage(512 * 1024 ** 2, 0),
      ),
    ).toBeNull();
    expect(agentUsage(running)).toBeNull();
  });
});
