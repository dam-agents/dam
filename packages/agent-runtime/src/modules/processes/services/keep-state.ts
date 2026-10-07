import type { DocumentStore } from "../../../core/document-store.js";
import { taskIdentity } from "../domain/classify.js";
import type { ProcessesDocument } from "../domain/inventory.js";

export interface KeptProcesses {
  count(): number;
  onRelease(cb: () => void): void;
}

export interface KeepState {
  isKeptTask(sessionId: string, taskId: string): boolean;
  keptProcesses: KeptProcesses;
  setKeptProcesses(count: number): void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The keep decisions the rest of agent-runtime
 * reads, built before the harness runtime so both can share them. A Harness
 * Task is kept unless the user overrode it. The count of running Detached
 * Processes that keep the agent awake comes from the last scan, and listeners
 * hear when it drops to zero, so a recycle waiting for an idle runtime can run.
 */
export function createKeepState(
  document: DocumentStore<ProcessesDocument>,
): KeepState {
  let kept = 0;
  const releaseListeners: (() => void)[] = [];

  return {
    isKeptTask(sessionId, taskId) {
      const key = taskIdentity({ sessionId, taskId });
      const override = document.read().overrides.find((o) => o.key === key);
      return override?.keepsAwake ?? true;
    },

    keptProcesses: {
      count: () => kept,
      onRelease(cb) {
        releaseListeners.push(cb);
      },
    },

    setKeptProcesses(count) {
      const released = kept > 0 && count === 0;
      kept = count;
      if (released) for (const cb of releaseListeners) cb();
    },
  };
}
