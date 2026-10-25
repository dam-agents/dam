// TEST_OVERVIEW: What a fresh session is created on. A caller that already decided — a channel whose row names a profile — sends its own values and they are what the session runs on, even when the agent has a default of its own, and the agent's default is not read at all, so such a channel runs on an agent that has none. A caller that names nothing gets the agent's channel default, and the session follows it.
import type { SessionPair } from "api-server-api";
import { describe, expect, it, vi } from "vitest";

import { sessionPlatformMeta } from "../../core/acp-client.js";

const CHANNEL: SessionPair = {
  harness: "claude-code",
  provider: "conn-channel",
  model: "cb/rits/deepseek-ai/DeepSeek-V4.1-Flash-1017",
  settings: { effort: "high" },
};

const AGENT: SessionPair = {
  harness: "codex",
  provider: "conn-agent",
  model: "ibm/aws/claude-opus-4-8",
};

const type = "channel_slack";

/* UNIT_BOUNDARY_DESCRIPTION: what a worker sends for a channel whose profile
 * resolved: the pair's own values, without the kind a following session takes. */
function pairMetaOf(pair: SessionPair) {
  return {
    harness: pair.harness,
    ...(pair.provider !== null && { provider: pair.provider }),
    ...(pair.model !== null && { model: pair.model }),
    ...(pair.settings && { settings: pair.settings }),
  };
}

describe("the meta a fresh session is created with", () => {
  /** TEST_SCENARIO: the channel's profile wins over the agent's channel default,
   * and the session does not follow that default afterwards. */
  it("runs on the channel's values, not the agent's default", async () => {
    const firePair = vi.fn(async () => AGENT);
    const platform = await sessionPlatformMeta({
      platformMeta: { type, threadTs: "t1", ...pairMetaOf(CHANNEL) },
      firePair,
      agentId: "agent-1",
    });
    expect(platform).toMatchObject({
      type,
      threadTs: "t1",
      harness: CHANNEL.harness,
      provider: CHANNEL.provider,
      model: CHANNEL.model,
      settings: CHANNEL.settings,
    });
    expect(platform.follows).toBeUndefined();
    expect(firePair).not.toHaveBeenCalled();
  });

  /** TEST_SCENARIO: a channel with a profile runs on an agent that has no default
   * at all — the default is never read, so its refusal never happens. */
  it("runs without an agent default", async () => {
    const firePair = vi.fn(async (): Promise<SessionPair | null> => null);
    const platform = await sessionPlatformMeta({
      platformMeta: { type, ...pairMetaOf(CHANNEL) },
      firePair,
      agentId: "agent-1",
    });
    expect(platform.model).toBe(CHANNEL.model);
    expect(firePair).not.toHaveBeenCalled();
  });

  /** TEST_SCENARIO: a channel that names no profile keeps the chain it always
   * had: the agent's channel default, which the session follows. */
  it("takes the agent's channel default when the channel names none", async () => {
    const platform = await sessionPlatformMeta({
      platformMeta: { type, threadTs: "t1" },
      firePair: async () => AGENT,
      agentId: "agent-1",
    });
    expect(platform).toMatchObject({
      type,
      threadTs: "t1",
      harness: AGENT.harness,
      provider: AGENT.provider,
      model: AGENT.model,
      follows: "channel",
    });
  });

  /** TEST_SCENARIO: nothing is added when the caller names nothing and the agent
   * has no default to fill in. */
  it("sends nothing when there is nothing to send", async () => {
    const platform = await sessionPlatformMeta({
      platformMeta: { type },
      firePair: async () => undefined,
      agentId: "agent-1",
    });
    expect(platform).toEqual({ type });
  });
});
