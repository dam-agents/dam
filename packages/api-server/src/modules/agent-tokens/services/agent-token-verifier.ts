import { err, ok, type Result } from "../../../core/result.js";
import type { AgentTokenCodec, AgentTokenIdentity } from "../domain/token.js";

export type AgentTokenRefusal =
  | "unknown"
  | "expired"
  | "agent-gone"
  | "owner-mismatch"
  | "not-assistant"
  | "flag-off";

export interface AgentTokenVerifierDeps {
  codec: AgentTokenCodec;
  agentOf: (
    agentId: string,
  ) => Promise<{ owner: string | null; kind?: string } | null>;
  /* UNIT_BOUNDARY_DESCRIPTION: whether the install offers assistants to this owner right now — read at every use, so switching the feature off ends every token already minted. */
  featureOn: (ownerSub: string) => Promise<boolean>;
}

export type AgentTokenVerifier = (
  token: string,
) => Promise<Result<AgentTokenIdentity, AgentTokenRefusal>>;

/**
 * UNIT_BOUNDARY_DESCRIPTION: what makes a minted token usable at this moment:
 * the signature and expiry the codec proves, and then the live facts the
 * signature cannot know — the Agent still exists, it is still an assistant,
 * its owner label is still the one the token was minted for, and the install
 * still offers assistants to that owner.
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
    if (!(await deps.featureOn(claims.ownerSub))) return err("flag-off");
    return ok(claims);
  };
}
