import type { Subscription } from "rxjs";
import type { LiveEventsService } from "api-server-api";
import type { RedisBus } from "../../core/redis-bus.js";
import { createRedisLiveEventsBus } from "./infrastructure/redis-live-events-bus.js";
import { startAgentWatch } from "./infrastructure/k8s-agent-watch.js";
import { createLiveEventsService } from "./services/live-events-service.js";
import { startLiveHintsSaga } from "./sagas/live-hints.js";
import {
  AGENTS_PLURAL,
  LABEL_OWNER,
  LAST_ACTIVITY_KEY,
} from "../agents/infrastructure/labels.js";
import type { K8sClient } from "../agents/infrastructure/k8s.js";

export interface LiveEventsModule {
  liveEvents: LiveEventsService;
  start(): void;
  stop(): void;
  startAgentWatch(): void;
  stopAgentWatch(): void;
}

export function composeLiveEventsModule(deps: {
  bus: RedisBus;
  log: (message: string) => void;
  k8s?: Pick<K8sClient, "watchCustomObjects">;
}): LiveEventsModule {
  const bus = createRedisLiveEventsBus(deps.bus, deps.log);
  let saga: Subscription | null = null;
  let watch: { stop(): void } | null = null;
  return {
    liveEvents: createLiveEventsService({ bus }),
    start() {
      saga ??= startLiveHintsSaga(bus);
    },
    stop() {
      saga?.unsubscribe();
      saga = null;
    },
    startAgentWatch() {
      if (!deps.k8s || watch) return;
      watch = startAgentWatch(bus, deps.k8s, {
        plural: AGENTS_PLURAL,
        ownerLabel: LABEL_OWNER,
        volatileAnnotations: [LAST_ACTIVITY_KEY],
        log: deps.log,
      });
    },
    stopAgentWatch() {
      watch?.stop();
      watch = null;
    },
  };
}
