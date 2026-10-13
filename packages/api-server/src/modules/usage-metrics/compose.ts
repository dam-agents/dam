import type { Meter } from "@opentelemetry/api";
import type { Subscription } from "rxjs";
import type { LeaderRole } from "../../core/leader-lease.js";
import { createActorDayLedger } from "./domain/actor-days.js";
import {
  createHarnessResolver,
  harnessLabels,
  type AgentHarness,
} from "./domain/harness.js";
import type { StateCountsReader } from "./domain/state-snapshot.js";
import { registerOtelStateGauges } from "./infrastructure/state-gauges-otel.js";
import { createOtelUsageRecorder } from "./infrastructure/usage-recorder.js";
import { startUsageMetricsSaga } from "./sagas/record-usage.js";
import { createStateGauges } from "./services/state-gauges.js";

const STATE_REFRESH_MS = 5 * 60_000;

export interface UsageMetricsModule {
  start(): void;
  stop(): void;
  stateGaugesRole: LeaderRole;
}

export function composeUsageMetricsModule(deps: {
  meter: Meter;
  stateCounts: StateCountsReader;
  harnessOf: (agentId: string) => AgentHarness;
  knownHarnesses: ReadonlySet<string>;
  now: () => number;
}): UsageMetricsModule {
  let sub: Subscription | null = null;
  const harnessOf = createHarnessResolver({
    harnessOf: deps.harnessOf,
    known: deps.knownHarnesses,
  });
  const stateGauges = createStateGauges({
    reader: deps.stateCounts,
    harnessOf,
    harnesses: harnessLabels(deps.knownHarnesses),
    refreshMs: STATE_REFRESH_MS,
  });
  registerOtelStateGauges(deps.meter, stateGauges.current);
  return {
    start() {
      sub ??= startUsageMetricsSaga({
        recorder: createOtelUsageRecorder(deps.meter),
        harnessOf,
        actorDays: createActorDayLedger({ now: deps.now }),
      });
    },
    stop() {
      sub?.unsubscribe();
      sub = null;
      stateGauges.stop();
    },
    stateGaugesRole: {
      name: "usage-state-gauges",
      onAcquired: () => stateGauges.start(),
      onLost: () => stateGauges.stop(),
    },
  };
}
