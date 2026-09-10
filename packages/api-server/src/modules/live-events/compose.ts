import type { Subscription } from "rxjs";
import type { LiveEventsService, PodSessionsService } from "api-server-api";
import type { RedisBus } from "../../core/redis-bus.js";
import { createRedisLiveEventsBus } from "./infrastructure/redis-live-events-bus.js";
import { startAgentWatch } from "./infrastructure/agent-watch.js";
import { createLiveEventsService } from "./services/live-events-service.js";
import { createPodSessionsService } from "./services/pod-sessions-service.js";
import { createPodSessionWatcher } from "./infrastructure/pod-session-watch.js";
import { startLiveHintsSaga } from "./sagas/live-hints.js";
import { LAST_ACTIVITY_KEY } from "../agents/infrastructure/labels.js";
import type { AgentStore } from "../agents/infrastructure/agent-store.js";
import type { AgentsRepository } from "../agents/infrastructure/agents-repository.js";
import type { RuntimeFeatures } from "agent-runtime-api";
import { agentStreamable } from "../agents/index.js";
import type { SandboxAddresses } from "../agents/infrastructure/sandbox-addresses.js";

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
  agentStore: Pick<AgentStore, "onChange">;
  sandboxAddresses: SandboxAddresses;
  agentsRepo: Pick<AgentsRepository, "list">;
  runtimeFeaturesFor: (
    agentIds: string[],
  ) => Promise<Map<string, RuntimeFeatures>>;
}): LiveEventsModule {
  const bus = createRedisLiveEventsBus(deps.bus, deps.log);
  let saga: Subscription | null = null;
  let watch: { stop(): void } | null = null;
  const podSessions = createPodSessionsService({
    log: deps.log,
    listRunningAgentIds: async (ownerSub) => {
      const running = (await deps.agentsRepo.list(ownerSub))
        .filter(agentStreamable)
        .map((agent) => agent.id);
      const features = await deps.runtimeFeaturesFor(running);
      return running.filter((id) => features.get(id)?.liveUpdates);
    },
    watchAgent: createPodSessionWatcher(deps.sandboxAddresses, deps.log),
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
      watch = startAgentWatch(bus, deps.agentStore, {
        volatileAnnotations: [LAST_ACTIVITY_KEY],
      });
    },
    stopAgentWatch() {
      watch?.stop();
      watch = null;
    },
  };
}
