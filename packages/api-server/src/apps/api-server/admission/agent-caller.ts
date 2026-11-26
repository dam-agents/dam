import { err, ok, type Result } from "../../../core/result.js";

export interface AgentCaller {
  agentId: string;
  ownerSub: string;
}

export type AgentCallerRefusal = "unknown" | "no-platform-access";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Decides whether an Agent Key opens the platform
 * API. The key must name an Agent, and that Agent's grant of the platform
 * Connection must store a Platform Access that lets it read itself. Both are
 * read on every request, so an owner who clears the access, or removes the
 * grant or the key, closes the API to the Agent from its next call.
 */
export function createAgentCallerVerifier(deps: {
  agentOfKey: (key: string) => Promise<AgentCaller | null>;
  readsItself: (agentId: string) => Promise<boolean>;
}): (key: string) => Promise<Result<AgentCaller, AgentCallerRefusal>> {
  return async (key) => {
    const caller = await deps.agentOfKey(key);
    if (caller === null) return err("unknown");
    if (!(await deps.readsItself(caller.agentId)))
      return err("no-platform-access");
    return ok(caller);
  };
}
