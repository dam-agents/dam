// TEST_OVERVIEW: A pick inside a running chat is the next chat's default too (D90): a model switch and a settings change are saved as the chat default once the session has taken them, and the profile the pair still matches travels with the save, so a tune does not silently detach the primary from its profile.
import type { ProfileWithUsage, SessionPair } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  primaryProfileOf,
  subagentSaveReferences,
} from "../../modules/sessions/lib/subagent-choice.js";

const profile = (
  overrides: Partial<ProfileWithUsage> = {},
): ProfileWithUsage => ({
  id: "p1",
  name: "QA Codex",
  harness: "codex",
  providerTemplate: "openai",
  model: "openai/gpt-6-luna",
  settings: { effort: "high" },
  seeded: false,
  createdAt: "",
  updatedAt: "",
  usage: { agents: 0, channels: 0, schedules: 0 },
  availability: { available: true, reason: null, attachable: false },
  ...overrides,
});

describe("the profile a session's pair still is", () => {
  /** TEST_SCENARIO: a subagent choice writes slot keys onto the same pair and
   * must not make the primary stop being its profile (QA D2). */
  it("matches the profile once a subagent choice is on the pair", () => {
    const pair: SessionPair = {
      harness: "codex",
      provider: "conn-1",
      model: "openai/gpt-6-luna",
      settings: {
        effort: "high",
        "platformSubagent.harness": "claude-code",
        "platformSubagent.model": "anthropic/claude-sonnet-5-5",
      },
    };
    expect(primaryProfileOf(pair, [profile()])?.id).toBe("p1");
  });

  /** TEST_SCENARIO: a tuned model is no longer that profile, so the save is a
   * custom pick. */
  it("stops matching once the model is tuned", () => {
    expect(
      primaryProfileOf(
        {
          harness: "codex",
          provider: "conn-1",
          model: "openai/gpt-6-other",
          settings: { effort: "high" },
        },
        [profile()],
      ),
    ).toBe(null);
  });

  /** TEST_SCENARIO: a slot pick whose native model differs from the primary
   * profile's own still leaves the primary that profile, since the native
   * subagent's keys belong to the choice, not to the primary. */
  it("ignores the native subagent keys when matching", () => {
    expect(
      primaryProfileOf(
        {
          harness: "codex",
          provider: "conn-1",
          model: "openai/gpt-6-luna",
          settings: {
            effort: "high",
            subagentModel: "anthropic/claude-sonnet-5-5",
            subagentEffort: "low",
          },
        },
        [profile()],
      )?.id,
    ).toBe("p1");
  });
});

describe("the references a subagent save writes", () => {
  const pair: SessionPair = {
    harness: "codex",
    provider: "conn-1",
    model: "openai/gpt-6-luna",
    settings: { effort: "high" },
  };
  const slot = profile({
    id: "slot-1",
    name: "Fast review",
    harness: "claude-code",
    model: "anthropic/claude-sonnet-5-5",
  });

  /** TEST_SCENARIO: the attach-then-save and slot-pick paths keep the primary's
   * reference beside the slot's (QA D2). */
  it("keeps the primary's reference beside the slot's", () => {
    expect(
      subagentSaveReferences({ pair, slot, profiles: [profile(), slot] }),
    ).toEqual({ platformSubagentProfileId: "slot-1", profileId: "p1" });
  });

  /** TEST_SCENARIO: "Let the agent pick" clears the slot and keeps the primary. */
  it("clears the slot and keeps the primary when the agent picks", () => {
    expect(
      subagentSaveReferences({ pair, slot: null, profiles: [profile()] }),
    ).toEqual({ platformSubagentProfileId: null, profileId: "p1" });
  });

  /** TEST_SCENARIO: a primary that is nobody's profile stays custom. */
  it("writes no primary reference for a custom primary", () => {
    expect(
      subagentSaveReferences({
        pair: { ...pair, model: "openai/gpt-6-other" },
        slot,
        profiles: [profile(), slot],
      }),
    ).toEqual({ platformSubagentProfileId: "slot-1", profileId: null });
  });
});
