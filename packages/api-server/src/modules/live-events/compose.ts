import type { Subscription } from "rxjs";
import type { LiveEventsService, PodSessionsService } from "api-server-api";
import type { RedisBus } from "../../core/redis-bus.js";
import { createRedisLiveEventsBus } from "./infrastructure/redis-live-events-bus.js";
import { startAgentWatch } from "./infrastructure/k8s-agent-watch.js";
import { createLiveEventsService } from "./services/live-events-service.js";
import { createPodSessionsService } from "./services/pod-sessions-service.js";
import { createPodSessionWatcher } from "./infrastructure/pod-session-watch.js";
import { startLiveHintsSaga } from "./sagas/live-hints.js";
import {
  AGENTS_PLURAL,
  LABEL_OWNER,
  LAST_ACTIVITY_KEY,
} from "../agents/infrastructure/labels.js";
import type { K8sClient } from "../agents/infrastructure/k8s.js";
import type { AgentsRepository } from "../agents/infrastructure/agents-repository.js";
import { agentStreamable } from "../agents/index.js";

export interface LiveEventsModule {
  liveEvents: LiveEventsService;
  podSessions: PodSessionsService;
  start(): void;
  stop(): void;
  startAgentWatch(): void;
  stopAgentWatch(): void;
}

export function composeLiveEventsModule(deps: {
  bus: RedisBus;
  log: (message: string) => void;
  k8s: Pick<K8sClient, "watchCustomObjects">;
  namespace: string;
  agentsRepo: Pick<AgentsRepository, "list">;
}): LiveEventsModule {
  const bus = createRedisLiveEventsBus(deps.bus, deps.log);
  let saga: Subscription | null = null;
  let watch: { stop(): void } | null = null;
  const podSessions = createPodSessionsService({
    log: deps.log,
    listRunningAgentIds: async (ownerSub) =>
      (await deps.agentsRepo.list(ownerSub))
        .filter(agentStreamable)
        .map((agent) => agent.id),
    watchAgent: createPodSessionWatcher(deps.namespace, deps.log),
    onAgentsChanged: (ownerSub, listener) =>
      bus.subscribe(ownerSub, (event) => {
        if (event.topic === "agents" || event.topic === "sync") listener();
      }),
  });

  return {
    liveEvents: createLiveEventsService({ bus }),
    podSessions,
    start() {
      saga ??= startLiveHintsSaga(bus);
    },
    stop() {
      saga?.unsubscribe();
      saga = null;
    },
    startAgentWatch() {
      if (watch) return;
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
