// TEST_OVERVIEW: What a channel's turns run on. A channel that names a profile runs on it; one that names none predates profiles and keeps the chain it always had; and a profile that cannot run on the agent is a refusal with its reason, never another model.
import { describe, expect, it } from "vitest";
import { channelTurnPair } from "../../modules/channels/domain/channel-pair.js";

const PAIR = {
  harness: "claude-code",
  provider: "conn-1",
  model: "cb/rits/deepseek-ai/DeepSeek-V4.1-Flash-1017",
};

const resolved = (overrides: Record<string, unknown> = {}) => ({
  pair: PAIR,
  profile: {
    name: "Fast review",
    providerTemplate: "curve-bender-deployment",
  },
  unavailable: null,
  grantableProvider: null,
  ...overrides,
});

describe("what a channel's turns run on", () => {
  /** TEST_SCENARIO: the channel names a profile, so its turns run on that
   * profile's values. */
  it("runs on the channel's profile", async () => {
    const decision = await channelTurnPair({
      profileId: "profile-1",
      agentId: "agent-1",
      resolveProfile: async () => resolved(),
    });
    expect(decision).toEqual({ kind: "profile", pair: PAIR });
  });

  /** TEST_SCENARIO: a channel from before profiles names none, and keeps the
   * agent's default it followed. */
  it("leaves the agent's default in place when the channel names no profile", async () => {
    const decision = await channelTurnPair({
      profileId: null,
      agentId: "agent-1",
      resolveProfile: async () => null,
    });
    expect(decision).toEqual({ kind: "none" });
  });

  /** TEST_SCENARIO: a profile whose provider the agent lost cannot run, and the
   * turn is refused with the profile's name and the reason, which is not the
   * same as a channel that names no profile at all. */
  it("refuses with the reason for a profile that cannot run here", async () => {
    const decision = await channelTurnPair({
      profileId: "profile-1",
      agentId: "agent-1",
      resolveProfile: async () =>
        resolved({
          unavailable: { detail: "AWS Bedrock is not connected" },
        }),
    });
    expect(decision).toEqual({
      kind: "unavailable",
      profileName: "Fast review",
      detail: "AWS Bedrock is not connected",
    });
  });

  /** TEST_SCENARIO: a provider the owner holds and the agent does not is refused
   * with the fix named, because an unattended turn has nobody to attach it. */
  it("refuses a provider the agent does not hold, and names the fix", async () => {
    const decision = await channelTurnPair({
      profileId: "profile-1",
      agentId: "agent-1",
      resolveProfile: async () => resolved({ grantableProvider: "conn-1" }),
    });
    expect(decision).toMatchObject({
      kind: "unavailable",
      profileName: "Fast review",
    });
    expect((decision as { detail: string }).detail).toContain(
      "isn't attached to this agent",
    );
  });

  /** TEST_SCENARIO: a reference the owner no longer holds is a refusal too, not
   * a legacy channel. */
  it("refuses a profile nobody holds", async () => {
    const decision = await channelTurnPair({
      profileId: "profile-gone",
      agentId: "agent-1",
      resolveProfile: async () => null,
    });
    expect(decision.kind).toBe("unavailable");
  });
});
