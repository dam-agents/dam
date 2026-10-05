// TEST_OVERVIEW: the harness a driver runs, which spawn_subagent compares against. It is read from the Agent spec first, because one image serves every harness.
import { describe, it, expect } from "vitest";
import type { TemplatesService } from "api-server-api";
import { createDriverOps } from "../../apps/harness-api-server/driver-ops.js";

const templates: TemplatesService = {
  list: async () => [
    {
      id: "claude-code",
      name: "claude-code",
      spec: {
        version: "agent-platform.ai/v1",
        image: "default:1",
        harness: "claude-code",
      },
    },
  ],
  get: async () => null,
};

const harnessOf = (spec: { image: string; harness?: string }) =>
  createDriverOps({
    agents: { get: async () => ({ templateId: "claude-code", spec }) },
    templates,
    invocationsServiceFor: () => ({}),
    connectionsServiceFor: () => ({}),
  } as unknown as Parameters<typeof createDriverOps>[0])({
    id: "driver-1",
    owner: "kc|owner-1",
  }).harness();

describe("driver harness", () => {
  // TEST_SCENARIO: every harness template shares one image and the template label can be stale after an upgrade, so the harness the Agent spec names is the one the machine runs.
  it("reads the harness from the agent spec first", async () => {
    expect(await harnessOf({ image: "default:1", harness: "codex" })).toBe(
      "codex",
    );
  });

  it("falls back to the agent's template when the spec names none", async () => {
    expect(await harnessOf({ image: "default:1" })).toBe("claude-code");
  });
});
