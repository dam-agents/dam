import { err, ok, type Result } from "../../../core/result.js";
import type { AgentTokenCodec, AgentTokenIdentity } from "../domain/token.js";

export type AgentTokenRefusal =
  | "unknown"
  | "expired"
  | "agent-gone"
  | "owner-mismatch"
  | "not-assistant"
  | "flag-off"
  | "owner-inactive";

export interface AgentTokenVerifierDeps {
  codec: AgentTokenCodec;
  agentOf: (
    agentId: string,
  ) => Promise<{ owner: string | null; kind?: string } | null>;
  /* UNIT_BOUNDARY_DESCRIPTION: whether the install offers assistants to this owner right now — read at every use, so switching the feature off ends every token already minted. */
  featureOn: (ownerSub: string) => Promise<boolean>;
  /* UNIT_BOUNDARY_DESCRIPTION: whether the owner behind the token still exists as a person the install admits. A deleted or disabled account's assistant loses its token, and an answer the directory cannot give refuses the token rather than admitting it. */
  ownerActive: (ownerSub: string) => Promise<boolean>;
}

export type VerifiedAgentIdentity = AgentTokenIdentity;

export type AgentTokenVerifier = (
  token: string,
) => Promise<Result<VerifiedAgentIdentity, AgentTokenRefusal>>;

/**
 * UNIT_BOUNDARY_DESCRIPTION: what makes a minted token usable at this moment:
 * the signature and expiry the codec proves, and then the live facts the
 * signature cannot know — the Agent still exists, it is still an assistant,
 * its owner label is still the one the token was minted for, the owner is still
 * an admitted person, and the install still offers assistants to them.
 */
export function createAgentTokenVerifier(
  deps: AgentTokenVerifierDeps,
): AgentTokenVerifier {
  return async (token) => {
    const claims = deps.codec.read(token);
    if (!claims) return err("unknown");
    const agent = await deps.agentOf(claims.agentId);
    if (!agent) return err("agent-gone");
    if (agent.kind !== "assistant") return err("not-assistant");
    if (agent.owner !== claims.ownerSub) return err("owner-mismatch");
    const active = await deps.ownerActive(claims.ownerSub).catch(() => false);
    if (!active) return err("owner-inactive");
    const offered = await deps.featureOn(claims.ownerSub).catch(() => false);
    if (!offered) return err("flag-off");
    return ok(claims);
  };
}
