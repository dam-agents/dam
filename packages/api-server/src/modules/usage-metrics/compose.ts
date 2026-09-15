import type { Meter } from "@opentelemetry/api";
import type { Subscription } from "rxjs";
import { createActorDayLedger } from "./domain/actor-days.js";
import {
  createTemplateResolver,
  type AgentTemplate,
} from "./domain/template.js";
import { createOtelUsageRecorder } from "./infrastructure/usage-recorder.js";
import { startUsageMetricsSaga } from "./sagas/record-usage.js";

export interface UsageMetricsModule {
  start(): void;
  stop(): void;
}

export function composeUsageMetricsModule(deps: {
  meter: Meter;
  templateOf: (agentId: string) => AgentTemplate;
  knownTemplates: ReadonlySet<string>;
  now: () => number;
}): UsageMetricsModule {
  let sub: Subscription | null = null;
  return {
    start() {
      sub ??= startUsageMetricsSaga({
        recorder: createOtelUsageRecorder(deps.meter),
        templateOf: createTemplateResolver({
          templateOf: deps.templateOf,
          known: deps.knownTemplates,
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
