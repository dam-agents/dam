import { getLogger } from "../../../core/logger.js";

export interface InvocationPinReconciler {
  tick(): Promise<{ released: number }>;
}

// UNIT_BOUNDARY_DESCRIPTION: an Invocation can end on many paths (result, failed setup, deadline, restart, cascade), so no path releases the Invocation Pin itself: every tick releases the pin of each Agent that no longer needs it — a Driver with no running Invocation, which is also no target whose own run waits to start. Only a spawn or a run sets a pin, so a sleep that cleared one is never overridden here. The Agent is read before it is checked and released only if it is still that version, so a spawn landing in between keeps its pin.
export function createInvocationPinReconciler(deps: {
  listPinnedAgentIds: () => Promise<string[]>;
  readPin: (agentId: string) => Promise<string | null>;
  hasRunningInvocation: (driverAgentId: string) => Promise<boolean>;
  runWaitsToStart: (targetAgentId: string) => Promise<boolean>;
  release: (agentId: string, version: string) => Promise<void>;
}): InvocationPinReconciler {
  return {
    async tick() {
      let released = 0;
      for (const id of await deps.listPinnedAgentIds()) {
        try {
          const version = await deps.readPin(id);
          if (version === null) continue;
          if (await deps.hasRunningInvocation(id)) continue;
          if (await deps.runWaitsToStart(id)) continue;
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
