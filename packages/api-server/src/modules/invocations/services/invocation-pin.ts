import { getLogger } from "../../../core/logger.js";

export interface InvocationPinReconciler {
  tick(): Promise<{ released: number }>;
}

// UNIT_BOUNDARY_DESCRIPTION: an Invocation can end on many paths (result, failed setup, deadline, restart, cascade), so no path releases the Invocation Pin itself: every tick releases the pin of each Driver that no longer has a running Invocation. Only a spawn sets a pin, so a pause or stop that cleared one is never overridden here.
export function createInvocationPinReconciler(deps: {
  listPinnedAgentIds: () => Promise<string[]>;
  hasRunningInvocation: (driverAgentId: string) => Promise<boolean>;
  release: (driverAgentId: string) => Promise<void>;
}): InvocationPinReconciler {
  return {
    async tick() {
      let released = 0;
      for (const id of await deps.listPinnedAgentIds()) {
        try {
          if (await deps.hasRunningInvocation(id)) continue;
          await deps.release(id);
          released++;
        } catch (err) {
          getLogger().warn(
            { err, agentId: id },
            "invocation pin: release failed",
          );
        }
      }
      return { released };
    },
  };
}
