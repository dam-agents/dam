import type { InvocationsRepository } from "../infrastructure/invocations-repository.js";

/** Ceiling on Invocation chain depth during resolution. Chains are acyclic by
 *  construction (a target's id is a freshly-created agent id), so the cap is
 *  a corruption guard, not a real limit — resolution past it fails closed. */
const MAX_CHAIN_DEPTH = 16;

/**
 * Egress Aliasing resolution: an Invocation target has no egress identity of
 * its own — every request it makes is decided by its driver's rules. Follows
 * the driver chain from the calling agent up to the root non-target agent.
 */
export interface DriverResolution {
  /** Returns the root agent whose egress policy applies to `agentId` — the
   *  agent itself when it is no Invocation target. Null when the chain
   *  exceeds the depth ceiling (unresolvable — callers fail closed). */
  resolveRoot(agentId: string): Promise<string | null>;
}

export function createDriverResolution(deps: {
  repo: InvocationsRepository;
}): DriverResolution {
  return {
    async resolveRoot(agentId) {
      let current = agentId;
      for (let depth = 0; depth < MAX_CHAIN_DEPTH; depth++) {
        const row = await deps.repo.get(current);
        if (!row) return current;
        current = row.driverAgentId;
      }
      return null;
    },
  };
}
