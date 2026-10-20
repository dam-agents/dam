import type { ProviderStatusService } from "api-server-api";
import { formatError } from "../../../core/format-error.js";
import { getLogger } from "../../../core/logger.js";
import {
  SOURCE_TEMPLATES,
  sourcesInUse,
  type SourceReading,
} from "../domain/public-signals.js";
import { nextSnapshot, statusView } from "../domain/status.js";
import type { PublicSources } from "../infrastructure/public-sources.js";
import type { CallWindow } from "../infrastructure/redis-call-window.js";
import type { StatusSnapshots } from "../infrastructure/redis-status-snapshot.js";

export interface ProviderStatusEvaluator {
  evaluate(now: Date): Promise<void>;
}

const FAILED_RUNS_BEFORE_WARNING = 3;

export function createProviderStatusService(deps: {
  window: CallWindow;
  snapshots: StatusSnapshots;
  sources: PublicSources;
  connectedTemplates: () => Promise<string[]>;
}): ProviderStatusService & ProviderStatusEvaluator {
  const log = () => getLogger();

  const readSources = async (): Promise<SourceReading[]> => {
    let templateIds: string[];
    try {
      templateIds = await deps.connectedTemplates();
    } catch (err) {
      log().warn(
        { reason: formatError(err) },
        "provider_status.templates_unread",
      );
      templateIds = Object.values(SOURCE_TEMPLATES).flat();
    }
    return Promise.all(
      sourcesInUse(templateIds).map((source) => deps.sources.read(source)),
    );
  };

  return {
    async evaluate(now) {
      const [previous, calls, readings] = await Promise.all([
        deps.snapshots.read(),
        deps.window.read(now),
        readSources(),
      ]);
      const snapshot = nextSnapshot(previous, { calls, readings }, now);
      for (const reading of readings) {
        log().debug({ reading }, "provider_status.source_read");
        const failedRuns = snapshot.streaks[reading.source]?.failedRuns;
        if (failedRuns === FAILED_RUNS_BEFORE_WARNING)
          log().warn(
            { source: reading.source, runs: failedRuns },
            "provider_status.source_failing",
          );
      }
      await deps.snapshots.write(snapshot);
    },

    async view() {
      return statusView(await deps.snapshots.read());
    },
  };
}
