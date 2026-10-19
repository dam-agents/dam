import type { ProviderStatusService } from "api-server-api";
import { nextSnapshot, statusView } from "../domain/status.js";
import type { CallWindow } from "../infrastructure/redis-call-window.js";
import type { StatusSnapshots } from "../infrastructure/redis-status-snapshot.js";

export interface ProviderStatusEvaluator {
  evaluate(now: Date): Promise<void>;
}

export function createProviderStatusService(deps: {
  window: CallWindow;
  snapshots: StatusSnapshots;
}): ProviderStatusService & ProviderStatusEvaluator {
  return {
    async evaluate(now) {
      const [previous, calls] = await Promise.all([
        deps.snapshots.read(),
        deps.window.read(now),
      ]);
      await deps.snapshots.write(nextSnapshot(previous, { calls }, now));
    },

    async view() {
      return statusView(await deps.snapshots.read());
    },
  };
}
