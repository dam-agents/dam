import type { DocumentStore } from "../../../core/document-store.js";
import { taskIdentity } from "../domain/classify.js";
import type { ProcessesDocument } from "../domain/inventory.js";

export interface KeepPolicy {
  isKeptTask(sessionId: string, taskId: string): boolean;
  keptProcessCount(): number;
  onChange(cb: () => void): void;
}

export interface KeepState extends KeepPolicy {
  setKeptProcesses(count: number): void;
  taskKeepChanged(): void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The keep policy the harness side reads, built
 * before the harness runtime so both sides can share it. A Harness Task is
 * kept unless the user overrode it in the processes document. The count of
 * running Detached Processes that keep the agent awake comes from the last
 * scan. Listeners hear when the user changes a Harness Task's keep decision,
 * so the harness side reads which tasks are kept again.
 */
export function createKeepState(
  document: DocumentStore<ProcessesDocument>,
): KeepState {
  let kept = 0;
  const changeListeners: (() => void)[] = [];

  return {
    isKeptTask(sessionId, taskId) {
      const key = taskIdentity({ sessionId, taskId });
      const override = document.read().overrides.find((o) => o.key === key);
      return override?.keepsAwake ?? true;
    },

    keptProcessCount: () => kept,

    onChange(cb) {
      changeListeners.push(cb);
    },

    setKeptProcesses(count) {
      kept = count;
    },

    taskKeepChanged() {
      for (const cb of changeListeners) cb();
    },
  };
}
