// TEST_OVERVIEW: One subagent choice drives both kinds of subagent. A platform sub-agent is another agent and takes the choice's harness, model and settings; a native sub-agent runs inside the primary harness and takes the model only where that harness can run it, with the effort the harness offers. A primary pick keeps the subagent choice, and a subagent choice never makes the primary read as custom (QA D2). The subagent slot's Custom screen edits it as a pair of its own, without tool approval.
import type { HarnessCapability } from "agent-runtime-api";
import type { ProfileWithUsage, SessionPair } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  heldSubagent,
  nextSlots,
  pickProfile,
  primaryProfileOf,
  settingChanges,
  subagentOf,
  subagentPair,
  subagentSummary,
  withHeldSubagent,
  withSubagent,
  withSubagentPair,
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
  newAgentDefault: false,
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
      {
        id: "mode",
        name: "Mode",
        category: "mode",
        choices: ["auto", "bypassPermissions"].map((value) => ({
          value,
          name: value,
        })),
      },
    ],
  },
} as unknown as HarnessCapability;

describe("a subagent choice", () => {
  /** TEST_SCENARIO: the platform sub-agent takes the profile's settings, so its effort is prefilled (QA R3); on the primary harness the native subagent takes the model and the effort; on another harness only a model the agent lists, else the agent picks; no choice clears every key. */
  it("gives the native subagent only what the primary harness can run", () => {
    expect(withSubagent(primary, profile(), capability, []).settings).toEqual({
      "platformSubagent.harness": "claude-code",
      "platformSubagent.model": "anthropic/claude-sonnet-5-5",
      "platformSubagent.effort": "high",
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
      "platformSubagent.effort": "high",
    });
    const set = withSubagent(primary, profile(), capability, []);
    expect(withSubagent(set, null, capability, []).settings).toBeUndefined();
  });

  /** TEST_SCENARIO: a primary profile pick takes the profile's settings and keeps the subagent choice and the session's tool approval. */
  it("survives a primary profile pick, as does tool approval", () => {
    const set = withSubagent(
      { ...primary, settings: { mode: "bypassPermissions" } },
      profile(),
      capability,
      [],
    );
    const next = pickProfile(
      set,
      profile({ id: "p2", settings: {} }),
      capability,
      [],
    );
    expect(next.settings?.["platformSubagent.model"]).toBe(
      "anthropic/claude-sonnet-5-5",
    );
    expect(next.settings?.mode).toBe("bypassPermissions");
  });

  /** TEST_SCENARIO: the primary still reads as its profile with a subagent choice or a tool approval on the pair, and stops once its own values are tuned (QA D2). */
  it("leaves the primary on its profile", () => {
    const own = profile({ model: primary.model!, settings: {} });
    const set = withSubagent(
      { ...primary, settings: { mode: "bypassPermissions" } },
      profile(),
      capability,
      [],
    );
    expect(primaryProfileOf(set, [own], capability)?.id).toBe("p1");
    expect(
      primaryProfileOf(
        { ...set, settings: { ...set.settings, effort: "low" } },
        [own],
        capability,
      ),
    ).toBeNull();
  });

  /** TEST_SCENARIO: the subagent slot reads as a pair of its own for the Custom screen, with no mode even where one was stored (QA R2), and a pick there replaces every platform sub-agent value; a harness picked without a model holds only the harness. */
  it("edits the subagent slot as a pair, without tool approval", () => {
    const stored: SessionPair = {
      ...primary,
      settings: {
        mode: "auto",
        "platformSubagent.harness": "claude-code",
        "platformSubagent.model": "anthropic/claude-sonnet-5-5",
        "platformSubagent.mode": "bypassPermissions",
        "platformSubagent.effort": "low",
      },
    };
    expect(subagentPair(stored)).toEqual({
      harness: "claude-code",
      provider: null,
      model: "anthropic/claude-sonnet-5-5",
      settings: { effort: "low" },
    });
    const picked = withSubagentPair(
      stored,
      {
        harness: "codex",
        provider: "conn-2",
        model: "openai/gpt-6.1-sol",
        settings: { effort: "high" },
      },
      capability,
      [],
    );
    expect(picked.settings).toEqual({
      mode: "auto",
      "platformSubagent.harness": "codex",
      "platformSubagent.model": "openai/gpt-6.1-sol",
      "platformSubagent.effort": "high",
    });
    expect(
      withSubagentPair(
        stored,
        { harness: "pi", provider: null, model: null },
        capability,
        [],
      ).settings,
    ).toEqual({ mode: "auto", "platformSubagent.harness": "pi" });
    expect(settingChanges(stored.settings!, picked.settings!)).toEqual({
      "platformSubagent.harness": "codex",
      "platformSubagent.model": "openai/gpt-6.1-sol",
      "platformSubagent.mode": "",
      "platformSubagent.effort": "high",
    });
  });

  /** TEST_SCENARIO: a next-session pair that fell back, its provider detached, takes the subagent slot the saved default holds, a custom pick or a profile, and a primary profile pick then keeps it, so reconnecting through a profile row does not drop it (QA N3); a pair the person picked keeps its own slot, even none. */
  it("keeps the saved subagent slot through a fallback", () => {
    const custom = {
      "platformSubagent.harness": "claude-code",
      "platformSubagent.model": "bedrock/haiku",
    };
    const fallback: SessionPair = {
      harness: "claude-code",
      provider: null,
      model: null,
    };
    const held = withHeldSubagent(
      fallback,
      heldSubagent({ platformSubagentSettings: custom }, []),
      "claude-code",
    );
    expect(subagentOf(held)).toEqual({
      harness: "claude-code",
      model: "bedrock/haiku",
    });
    expect(
      subagentOf(pickProfile(held, profile({ id: "p2" }), capability, [])),
    ).toEqual({ harness: "claude-code", model: "bedrock/haiku" });
    expect(
      subagentOf(
        withHeldSubagent(
          null,
          heldSubagent({ platformSubagentProfileId: "p1" }, [profile()]),
          "pi",
        ),
      ),
    ).toEqual({ harness: "claude-code", model: "anthropic/claude-sonnet-5-5" });
    expect(withHeldSubagent(primary, custom, "pi")).toBe(primary);
  });

  /** TEST_SCENARIO: the subagent slot's custom pick reads as the one summary, its provider named by the model's alias (QA N4). */
  it("summarises the subagent pick with its provider", () => {
    expect(
      subagentSummary(
        withSubagent(primary, profile({ settings: {} }), capability, []),
        [],
        [{ id: "conn-a", name: "Anthropic", type: "anthropic" }],
      ),
    ).toBe("Claude Sonnet 5.5 (Anthropic)");
  });
});

describe("a pick onto the slots a schedule or a channel keeps", () => {
  const custom = {
    "platformSubagent.harness": "codex",
    "platformSubagent.model": "openai/gpt-5.5",
  };
  const current = {
    profileId: null,
    pair: null,
    platformSubagentProfileId: null,
    platformSubagentSettings: custom,
  };
  const pair: SessionPair = {
    harness: "claude-code",
    provider: null,
    model: "bedrock/opus",
    settings: { effort: "high", ...custom },
  };
  /** TEST_SCENARIO: as the server writes a chat default, a named primary profile stands in for its values, a primary pick that names no subagent reference keeps the subagent slot, and a subagent profile replaces the subagent's own values. */
  it("keeps both slots in the chat default's shape", () => {
    expect(nextSlots(current, pair, { profileId: "p1" })).toEqual({
      ...current,
      profileId: "p1",
    });
    expect(nextSlots(current, pair, {})).toEqual({
      ...current,
      pair: {
        harness: "claude-code",
        provider: null,
        model: "bedrock/opus",
        settings: { effort: "high" },
      },
    });
    expect(
      nextSlots(current, pair, {
        profileId: "p1",
        platformSubagentProfileId: "p2",
      }),
    ).toEqual({
      profileId: "p1",
      pair: null,
      platformSubagentProfileId: "p2",
      platformSubagentSettings: null,
    });
  });
});
