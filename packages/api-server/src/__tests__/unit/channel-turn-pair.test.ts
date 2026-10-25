// TEST_OVERVIEW: A channel runs on its own profile; a channel without one keeps the chain it always had, and a profile that cannot run on the agent stops the turn rather than running on a substitute.
import { describe, expect, it, vi } from "vitest";
import { channelTurnPair } from "../../modules/channels/domain/channel-pair.js";

const PAIR = {
  harness: "claude-code",
  provider: "conn-1",
  model: "cb/rits/deepseek-ai/DeepSeek-V4.1-Flash-1017",
};

describe("the pair a channel's turns run on", () => {
  /** TEST_SCENARIO: the channel names a profile, so its turns run on that
   * profile's values. */
  it("runs on the channel's profile", async () => {
    const fallback = vi.fn(async () => null);
    const pair = await channelTurnPair({
      profileId: "profile-1",
      agentId: "agent-1",
      fallback,
      resolveProfile: async () => ({ pair: PAIR, unavailable: null }),
    });
    expect(pair).toEqual(PAIR);
    expect(fallback).not.toHaveBeenCalled();
  });

  /** TEST_SCENARIO: a channel from before profiles has none, and keeps the chat
   * default it followed. */
  it("falls back to the chat default when the channel names no profile", async () => {
    const pair = await channelTurnPair({
      profileId: null,
      agentId: "agent-1",
      fallback: async () => PAIR,
      resolveProfile: async () => null,
    });
    expect(pair).toEqual(PAIR);
  });

  /** TEST_SCENARIO: a profile whose provider the agent lost cannot run, and the
   * turn reports no pair rather than another model. */
  it("reports no pair for a profile that cannot run here", async () => {
    const pair = await channelTurnPair({
      profileId: "profile-1",
      agentId: "agent-1",
      fallback: async () => PAIR,
      resolveProfile: async () => ({
        pair: PAIR,
        unavailable: { detail: "AWS Bedrock is not connected" },
      }),
    });
    expect(pair).toBeNull();
  });
});
