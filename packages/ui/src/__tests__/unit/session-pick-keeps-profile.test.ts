// TEST_OVERVIEW: A pick inside a running chat is the next chat's default too (D90): a model switch and a settings change are saved as the chat default once the session has taken them, and the profile the pair still matches travels with the save, so a tune does not silently detach the primary from its profile.
import type { ProfileWithUsage, SessionPair } from "api-server-api";
import { describe, expect, it } from "vitest";

import { primaryProfileOf } from "../../modules/sessions/lib/subagent-choice.js";

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
});
