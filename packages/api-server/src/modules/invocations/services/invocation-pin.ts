export interface DriverPin {
  set(driverAgentId: string): Promise<void>;
  release(driverAgentId: string): Promise<void>;
}

export interface InvocationPinReconciler {
  tick(): Promise<{ set: number; released: number }>;
}

// UNIT_BOUNDARY_DESCRIPTION: an Invocation can end on many paths (result, failed setup, deadline, restart, cascade), so the Invocation Pin is kept level-based rather than released by each of them: every tick pins exactly the Drivers that have a running Invocation, and releases the rest.
export function createInvocationPinReconciler(deps: {
  listRunningDriverIds: () => Promise<string[]>;
  listPinnedAgentIds: () => Promise<string[]>;
  pin: DriverPin;
  log?: (msg: string) => void;
}): InvocationPinReconciler {
  return {
    async tick() {
      const [running, pinned] = await Promise.all([
        deps.listRunningDriverIds(),
        deps.listPinnedAgentIds(),
      ]);
      const runningSet = new Set(running);
      const pinnedSet = new Set(pinned);
      let set = 0;
      let released = 0;
      for (const id of running) {
        if (pinnedSet.has(id)) continue;
        if (await attempt("set", id, () => deps.pin.set(id))) set++;
      }
      for (const id of pinned) {
        if (runningSet.has(id)) continue;
        if (await attempt("release", id, () => deps.pin.release(id)))
          released++;
      }
      return { set, released };
    },
  };

  async function attempt(
    verb: string,
    id: string,
    run: () => Promise<void>,
  ): Promise<boolean> {
    try {
      await run();
      return true;
    } catch (err) {
      deps.log?.(
        `[invocation-pin] ${verb} ${id} failed: ${err instanceof Error ? err.message : err}`,
      );
      return false;
    }
  }
}
