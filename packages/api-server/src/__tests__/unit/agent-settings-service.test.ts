import { describe, it, expect } from "vitest";
import type { AgentSettings } from "api-server-api";
import { createAgentSettingsService } from "../../modules/agent-settings/services/agent-settings-service.js";
import {
  harnessConfigSupported,
  type AgentSettingsRepository,
} from "../../modules/agent-settings/infrastructure/agent-settings-repository.js";

function makeHarness(opts?: {
  stored?: AgentSettings | null;
  supported?: boolean;
  owned?: boolean;
}) {
  const calls = {
    upserts: [] as Array<{ agentId: string; settings: AgentSettings }>,
    bumps: [] as string[],
    enqueues: [] as string[],
  };
  const repo: AgentSettingsRepository = {
    get: async () => opts?.stored ?? null,
    upsert: async (agentId, settings) => {
      calls.upserts.push({ agentId, settings });
    },
    deleteByAgent: async () => {},
    supportsHarnessConfig: async () => opts?.supported ?? true,
  };
  const service = createAgentSettingsService({
    repo,
    runtimeMutator: {
      bump: async (agentId) => {
        calls.bumps.push(agentId);
        return 1;
      },
      enqueueAfterCommit: async (agentId) => {
        calls.enqueues.push(agentId);
      },
    },
    isOwnedAgent: async () => opts?.owned ?? true,
  });
  return { service, calls };
}

const EMPTY: AgentSettings = { model: null, mode: null, configOptions: {} };

describe("agent-settings service", () => {
  it("returns empty defaults + supported flag when nothing is stored", async () => {
    const { service } = makeHarness({ stored: null, supported: true });
    expect(await service.get("a1")).toEqual({ ...EMPTY, supported: true });
  });

  it("returns stored settings with the harness's support flag", async () => {
    const stored: AgentSettings = {
      model: "opus",
      mode: "plan",
      configOptions: { thought_level: "high" },
    };
    const { service } = makeHarness({ stored, supported: false });
    expect(await service.get("a1")).toEqual({ ...stored, supported: false });
  });

  it("rejects get/set for an agent the caller doesn't own", async () => {
    const { service, calls } = makeHarness({ owned: false });
    await expect(service.get("a1")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(service.set("a1", EMPTY)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(calls.upserts).toHaveLength(0);
    expect(calls.bumps).toHaveLength(0);
  });

  it("upserts then re-delivers state (bump + enqueue) on set", async () => {
    const { service, calls } = makeHarness({ owned: true });
    const input: AgentSettings = {
      model: "sonnet",
      mode: null,
      configOptions: {},
    };
    const result = await service.set("a1", input);
    expect(result).toEqual(input);
    expect(calls.upserts).toEqual([{ agentId: "a1", settings: input }]);
    expect(calls.bumps).toEqual(["a1"]);
    expect(calls.enqueues).toEqual(["a1"]);
  });
});

describe("harnessConfigSupported", () => {
  it("treats unknown capabilities as supported (agent not booted yet)", () => {
    expect(harnessConfigSupported(null)).toBe(true);
    expect(harnessConfigSupported(undefined)).toBe(true);
  });

  it("is true only when the agent advertises the harness-config contribution", () => {
    expect(
      harnessConfigSupported({ contributions: ["file", "harness-config"] }),
    ).toBe(true);
    expect(
      harnessConfigSupported({ contributions: ["file", "mcp-entry"] }),
    ).toBe(false);
    expect(harnessConfigSupported({ contributions: "nope" })).toBe(false);
    expect(harnessConfigSupported({})).toBe(false);
  });
});
