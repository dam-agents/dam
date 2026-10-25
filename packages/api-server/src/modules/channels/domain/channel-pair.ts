import type { SessionPair } from "api-server-api";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the pair a channel's turns run on (D91). A channel
 * with a profile runs on it; one without predates profiles and still follows the
 * agent's chat default, which is the chain it always had. A profile that cannot
 * run on the agent yields no pair, which the turn reports as no default model
 * rather than running on a substitute.
 */
export async function channelTurnPair(input: {
  profileId: string | null;
  agentId: string;
  fallback: () => Promise<SessionPair | null>;
  resolveProfile: (input: { profileId: string; agentId: string }) => Promise<{
    pair: SessionPair;
    unavailable: { detail: string } | null;
  } | null>;
}): Promise<SessionPair | null> {
  if (input.profileId === null) return input.fallback();
  const resolved = await input.resolveProfile({
    profileId: input.profileId,
    agentId: input.agentId,
  });
  return resolved !== null && resolved.unavailable === null
    ? resolved.pair
    : null;
}
