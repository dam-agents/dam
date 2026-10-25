import type { SessionPair } from "api-server-api";

/**
 * UNIT_BOUNDARY_DESCRIPTION: what a channel's turn runs on (D91). A channel
 * whose row names a profile runs on it; one that names none predates profiles
 * and keeps the chain it always had — the agent's channel default, which the
 * turn is created with. A profile that cannot run on the agent is a third case
 * and not a fallback: the turn is refused with that reason, never run on
 * another model.
 */
export type ChannelPairDecision =
  | { kind: "profile"; pair: SessionPair }
  | { kind: "unavailable"; profileName: string; detail: string }
  | { kind: "none" };

export async function channelTurnPair(input: {
  profileId: string | null;
  agentId: string;
  resolveProfile: (input: { profileId: string; agentId: string }) => Promise<{
    pair: SessionPair;
    profile: { name: string };
    unavailable: { detail: string } | null;
  } | null>;
}): Promise<ChannelPairDecision> {
  if (input.profileId === null) return { kind: "none" };
  const resolved = await input.resolveProfile({
    profileId: input.profileId,
    agentId: input.agentId,
  });
  /* UNIT_BOUNDARY_DESCRIPTION: a reference nobody holds any more reads as such,
   * rather than as a channel that never named a profile. */
  if (resolved === null)
    return {
      kind: "unavailable",
      profileName: input.profileId,
      detail: "its owner no longer holds it",
    };
  if (resolved.unavailable !== null)
    return {
      kind: "unavailable",
      profileName: resolved.profile.name,
      detail: resolved.unavailable.detail,
    };
  return { kind: "profile", pair: resolved.pair };
}
