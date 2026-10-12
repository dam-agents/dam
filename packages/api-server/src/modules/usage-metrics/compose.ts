import type { Meter } from "@opentelemetry/api";
import type { Subscription } from "rxjs";
import { createActorDayLedger } from "./domain/actor-days.js";
import { createHarnessResolver, type AgentHarness } from "./domain/harness.js";
import { createOtelUsageRecorder } from "./infrastructure/usage-recorder.js";
import { startUsageMetricsSaga } from "./sagas/record-usage.js";

export interface UsageMetricsModule {
  start(): void;
  stop(): void;
}

export function composeUsageMetricsModule(deps: {
  meter: Meter;
  harnessOf: (agentId: string) => AgentHarness;
  knownHarnesses: ReadonlySet<string>;
  now: () => number;
}): UsageMetricsModule {
  let sub: Subscription | null = null;
  return {
    start() {
      sub ??= startUsageMetricsSaga({
        recorder: createOtelUsageRecorder(deps.meter),
        harnessOf: createHarnessResolver({
          harnessOf: deps.harnessOf,
          known: deps.knownHarnesses,
        }),
        actorDays: createActorDayLedger({ now: deps.now }),
      });
    },
    stop() {
      sub?.unsubscribe();
      sub = null;
    },
  };
}
