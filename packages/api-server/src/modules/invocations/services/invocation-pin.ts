import { getLogger } from "../../../core/logger.js";

export interface InvocationPinReconciler {
  tick(): Promise<{ released: number }>;
}

// UNIT_BOUNDARY_DESCRIPTION: an Invocation can end on many paths (result, failed setup, deadline, restart, cascade), so no path releases the Invocation Pin itself: every tick releases the pin of each Driver that no longer has a running Invocation. Only a spawn sets a pin, so a pause or stop that cleared one is never overridden here. The Driver is read before its Invocations are checked and released only if it is still that version, so a spawn landing in between keeps its pin.
export function createInvocationPinReconciler(deps: {
  listPinnedAgentIds: () => Promise<string[]>;
  readPin: (driverAgentId: string) => Promise<string | null>;
  hasRunningInvocation: (driverAgentId: string) => Promise<boolean>;
  release: (driverAgentId: string, version: string) => Promise<void>;
}): InvocationPinReconciler {
  return {
    async tick() {
      let released = 0;
      for (const id of await deps.listPinnedAgentIds()) {
        try {
          const version = await deps.readPin(id);
          if (version === null) continue;
          if (await deps.hasRunningInvocation(id)) continue;
          await deps.release(id, version);
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
