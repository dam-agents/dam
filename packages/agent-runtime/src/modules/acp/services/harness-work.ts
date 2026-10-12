import type { PendingRestart } from "agent-runtime-api";
import type { RunningHarness } from "./acp-runtime/acp-runtime.js";
import type { BackgroundWorkRegistry } from "./background-work-registry.js";
import type { LeaseRouter } from "./lease-router.js";

export interface ReportedTask {
  sessionId: string;
  taskId: string;
  command: string | undefined;
  description: string | undefined;
}

export interface HarnessWork {
  harnesses(): RunningHarness[];
  reportedTasks(): ReportedTask[];
  forgetTask(sessionId: string, taskId: string): void;
  pendingRestart(): PendingRestart | null;
  applyPendingRestart(): boolean;
  onChange(cb: () => void): void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Everything the processes module may see and do
 * on the harness side, in one place. It lists the running chat harnesses, one
 * per lease, with the start of their earliest running turn, and the Harness
 * Tasks every session reported, kept or not. It forgets a task that was
 * stopped or whose process is gone, and it reports and applies a harness
 * restart that waits for kept Harness Tasks. One data-less change signal
 * covers both a changed report and a waiting restart that appears or goes, so
 * the reader reads again.
 */
export function createHarnessWork(deps: {
  registry: BackgroundWorkRegistry;
  router: Pick<
    LeaseRouter,
    | "harnesses"
    | "pendingRestart"
    | "applyPendingRestart"
    | "onPendingRestartChange"
  >;
}): HarnessWork {
  return {
    harnesses: () => deps.router.harnesses(),

    reportedTasks: () =>
      deps.registry.reported().flatMap(({ sessionId, items }) =>
        items.map((item) => ({
          sessionId,
          taskId: item.id,
          command: item.command,
          description: item.description,
        })),
      ),

    forgetTask: (sessionId, taskId) => deps.registry.drop(sessionId, taskId),

    pendingRestart: () => deps.router.pendingRestart(),

    applyPendingRestart: () => deps.router.applyPendingRestart(),

    onChange(cb) {
      deps.registry.onChange(cb);
      deps.router.onPendingRestartChange(cb);
    },
  };
}
