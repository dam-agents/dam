import { displayNameForTemplate, type SessionPair } from "api-server-api";

const providerName = (template: string): string =>
  displayNameForTemplate(template) ?? template;

/**
 * UNIT_BOUNDARY_DESCRIPTION: what a fresh session in a channel runs on (D91).
 * A channel whose row names a profile runs on it; one that names none predates
 * profiles and keeps the chain it always had — the agent's channel default,
 * which the session is created with. A profile that cannot run on the agent is
 * a third case and not a fallback: the turn is refused with that reason, never
 * run on another model. A thread that is resumed keeps the values it already
 * runs on (D94 A, D119), so nothing here is applied to it.
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
    profile: { name: string; providerTemplate: string };
    unavailable: { detail: string } | null;
    grantableProvider: string | null;
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
  /* UNIT_BOUNDARY_DESCRIPTION: a provider the owner holds and the agent does
   * not is one a form attaches on the pick; nobody is there on a channel turn,
   * so it is a refusal that names the fix rather than a session started on a
   * grant the agent never had (R1). */
  if (resolved.grantableProvider !== null)
    return {
      kind: "unavailable",
      profileName: resolved.profile.name,
      detail: `${providerName(resolved.profile.providerTemplate)} isn't attached to this agent — attach it on the agent's Models section, or pick another profile`,
    };
  return { kind: "profile", pair: resolved.pair };
}
