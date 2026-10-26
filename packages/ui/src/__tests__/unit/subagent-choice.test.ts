// TEST_OVERVIEW: One subagent choice drives both kinds of subagent. A platform sub-agent is another agent and takes the choice's harness and model; a native sub-agent runs inside the primary harness and takes the model only where that harness can run it, with the effort the harness offers. A primary pick keeps the subagent choice, and a subagent choice never makes the primary read as custom (QA D2).
import type { HarnessCapability } from "agent-runtime-api";
import type { ProfileWithUsage, SessionPair } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  pickProfile,
  primaryProfileOf,
  withSubagent,
} from "../../modules/sessions/lib/subagent-choice.js";

const profile = (
  overrides: Partial<ProfileWithUsage> = {},
): ProfileWithUsage => ({
  id: "p1",
  name: "Fast review",
  harness: "claude-code",
  providerTemplate: "anthropic",
  model: "anthropic/claude-sonnet-5-5",
  settings: { effort: "high" },
  seeded: false,
  usage: { agents: 0, channels: 0, schedules: 0 },
  availability: { available: true, reason: null, attachable: false },
  ...overrides,
});

const primary: SessionPair = {
  harness: "claude-code",
  provider: "conn-1",
  model: "anthropic/claude-mythos-5-1",
};

const capability = {
  name: "claude-code",
  harnessConfig: true,
  sessionSettings: ["effort", "subagentModel", "subagentEffort"],
  harnessConfigCatalog: {
    options: [
      {
        id: "subagentEffort",
        name: "Subagent effort",
        category: "config",
        subagents: true,
        choices: ["low", "high"].map((value) => ({ value, name: value })),
      },
    ],
  },
} as unknown as HarnessCapability;

describe("a subagent choice", () => {
  /** TEST_SCENARIO: on the primary harness the native subagent takes the model and the effort; on another harness only a model the agent lists, else the agent picks; no choice clears every key. */
  it("gives the native subagent only what the primary harness can run", () => {
    expect(withSubagent(primary, profile(), capability, []).settings).toEqual({
      "platformSubagent.harness": "claude-code",
      "platformSubagent.model": "anthropic/claude-sonnet-5-5",
      subagentModel: "anthropic/claude-sonnet-5-5",
      subagentEffort: "high",
    });
    const codex = profile({ harness: "codex", model: "openai/gpt-6.1-sol" });
    expect(
      withSubagent(primary, codex, capability, [{ name: "openai/gpt-6.1-sol" }])
        .settings?.subagentModel,
    ).toBe("openai/gpt-6.1-sol");
    expect(withSubagent(primary, codex, capability, []).settings).toEqual({
      "platformSubagent.harness": "codex",
      "platformSubagent.model": "openai/gpt-6.1-sol",
    });
    const set = withSubagent(primary, profile(), capability, []);
    expect(withSubagent(set, null, capability, []).settings).toBeUndefined();
  });

  /** TEST_SCENARIO: a primary profile pick takes the profile's settings and keeps the subagent choice the pair held. */
  it("survives a primary profile pick", () => {
    const set = withSubagent(primary, profile(), capability, []);
    const next = pickProfile(
      set,
      profile({ id: "p2", settings: {} }),
      capability,
      [],
    );
    expect(next.settings?.["platformSubagent.model"]).toBe(
      "anthropic/claude-sonnet-5-5",
    );
  });

  /** TEST_SCENARIO: the primary still reads as its profile with a subagent choice on the pair, and stops once its own values are tuned (QA D2). */
  it("leaves the primary on its profile", () => {
    const own = profile({ model: primary.model!, settings: {} });
    const set = withSubagent(primary, profile(), capability, []);
    expect(primaryProfileOf(set, [own])?.id).toBe("p1");
    expect(
      primaryProfileOf(
        { ...set, settings: { ...set.settings, effort: "low" } },
        [own],
      ),
    ).toBeNull();
  });
});
