// TEST_OVERVIEW: One subagent profile drives both kinds of subagent. A platform sub-agent is another agent and takes the profile's harness and model; a native sub-agent runs inside the primary harness and takes the profile's model only where that harness can run it, with its effort when the harness offers one.
import type { HarnessCapability } from "agent-runtime-api";
import type { ProfileWithUsage, SessionPair } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  subagentChoice,
  subagentSettings,
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
  createdAt: "",
  updatedAt: "",
  usage: { agents: 0, channels: 0, schedules: 0 },
  availability: { available: true, reason: null, attachable: false },
  ...overrides,
});

const primary = (overrides: Partial<SessionPair> = {}): SessionPair => ({
  harness: "claude-code",
  provider: "conn-1",
  model: "anthropic/claude-mythos-5-1",
  ...overrides,
});

const capability = (
  effortChoices = ["low", "medium", "high"],
): HarnessCapability =>
  ({
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
          choices: effortChoices.map((value) => ({ value, name: value })),
        },
      ],
    },
  }) as unknown as HarnessCapability;

describe("the subagent profile's contribution", () => {
  /** TEST_SCENARIO: the profile runs on the primary harness, so the native
   * subagent takes its model and the effort it names. */
  it("applies the model and effort when the harness is the primary one", () => {
    const choice = subagentChoice(profile(), primary(), capability(), []);
    expect(choice).toEqual({
      platform: {
        harness: "claude-code",
        model: "anthropic/claude-sonnet-5-5",
      },
      native: { model: "anthropic/claude-sonnet-5-5", effort: "high" },
    });
  });

  /** TEST_SCENARIO: another harness, but the agent lists the profile's model for
   * the primary harness, so the native subagent can run it. */
  it("applies the model on another harness when the primary can run it", () => {
    const choice = subagentChoice(
      profile({ harness: "codex" }),
      primary(),
      capability(),
      [{ name: "anthropic/claude-sonnet-5-5" }],
    );
    expect(choice.native.model).toBe("anthropic/claude-sonnet-5-5");
  });

  /** TEST_SCENARIO: another harness and a model the primary cannot run, so the
   * native subagent falls back to the agent's own pick while the platform one
   * keeps the profile. */
  it("leaves the native subagent to the agent when the model cannot run here", () => {
    const choice = subagentChoice(
      profile({ harness: "codex" }),
      primary(),
      capability(),
      [],
    );
    expect(choice.native).toEqual({ model: "" });
    expect(choice.platform).toEqual({
      harness: "codex",
      model: "anthropic/claude-sonnet-5-5",
    });
  });

  it("drops an effort the harness does not offer", () => {
    const choice = subagentChoice(
      profile({ settings: { effort: "maximum" } }),
      primary(),
      capability(["low", "medium"]),
      [],
    );
    expect(choice.native.effort).toBeUndefined();
  });

  it("writes the slot keys and the native ones, and clears them when off", () => {
    expect(
      subagentSettings(subagentChoice(profile(), primary(), capability(), [])),
    ).toEqual({
      "platformSubagent.harness": "claude-code",
      "platformSubagent.model": "anthropic/claude-sonnet-5-5",
      subagentModel: "anthropic/claude-sonnet-5-5",
      subagentEffort: "high",
    });
    expect(subagentSettings(null)).toEqual({
      "platformSubagent.harness": "",
      "platformSubagent.model": "",
    });
  });
});
