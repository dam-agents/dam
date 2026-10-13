import { getLogger } from "../../../core/logger.js";
import { formatError } from "../../../core/format-error.js";
import type { HarnessOf } from "../domain/harness.js";
import {
  countAgents,
  countSlackWorkspaces,
  type StateCountsReader,
  type StateSnapshot,
} from "../domain/state-snapshot.js";

export interface StateGauges {
  start(): Promise<void>;
  stop(): void;
  current(): StateSnapshot | null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: holds the install-wide counts of things that
 * exist, refreshed on an interval while this replica holds the role. Only the
 * holder reports, so replicas never export the same state twice; losing the
 * role drops the snapshot, and a failed refresh keeps the previous one.
 */
export function createStateGauges(deps: {
  reader: StateCountsReader;
  harnessOf: HarnessOf;
  harnesses: ReadonlySet<string>;
  refreshMs: number;
}): StateGauges {
  let snapshot: StateSnapshot | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let generation = 0;

  async function refresh(forGeneration: number): Promise<void> {
    try {
      const [liveAgents, slackWorkspaces, sharedKnowledgeBases, skillSets] =
        await Promise.all([
          deps.reader.liveAgents(),
          deps.reader.slackWorkspacesByState(),
          deps.reader.activeKbShares(),
          deps.reader.skillSets(),
        ]);
      if (forGeneration !== generation) return;
      snapshot = {
        agents: countAgents(liveAgents, deps.harnessOf, deps.harnesses),
        slackWorkspaces: countSlackWorkspaces(slackWorkspaces),
        sharedKnowledgeBases,
        skillSets,
      };
    } catch (err) {
      getLogger().warn(
        { reason: formatError(err) },
        "usage_metrics.state_refresh_error",
      );
    }
  }

  return {
    async start() {
      if (timer) return;
      const current = ++generation;
      timer = setInterval(() => void refresh(current), deps.refreshMs);
      timer.unref();
      await refresh(current);
    },
    stop() {
      generation++;
      if (timer) clearInterval(timer);
      timer = null;
      snapshot = null;
    },
    current: () => snapshot,
  };
}
