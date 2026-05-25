import { Hono } from "hono";
import type {
  SchedulesService,
  SkillsService,
  RuntimeDeliveryService,
  TriggerEventHandler,
} from "api-server-api";
import { mountMcpRoutes } from "./mcp-endpoint.js";
import { mountRuntimeTrpc } from "./runtime-trpc.js";
import { mountScheduleFiredRoute } from "./schedule-fired.js";
import type { ChannelManager } from "./../../modules/channels/services/channel-manager.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import type { Db } from "db";
import type { RuntimeMutator } from "../../modules/runtime-delivery/index.js";

export function createHarnessRouter(deps: {
  channelManager: ChannelManager;
  k8s: K8sClient;
  composeSkills: (owner: string) => SkillsService;
  agentHome: string;
  schedulesServiceFor: (owner: string) => SchedulesService;
  // ADR-052: runtime channel surface on the harness API. Agent calls
  // runtime.v1.hello on boot/wake and runtime.v1.events.* per event.
  runtimeHello: RuntimeDeliveryService;
  triggerEventHandler: TriggerEventHandler;
  // ADR-053: schedule-fired hook for the controller's cron. Replaces the
  // legacy `kubectl exec`-into-`~/.triggers/` mechanism (ADR-008 retired).
  db: Db;
  runtimeMutator: RuntimeMutator;
}) {
  const app = new Hono();

  mountMcpRoutes(app, {
    channelManager: deps.channelManager,
    k8s: deps.k8s,
    composeSkills: deps.composeSkills,
    agentHome: deps.agentHome,
    schedulesServiceFor: deps.schedulesServiceFor,
  });
  mountRuntimeTrpc(app, {
    k8s: deps.k8s,
    hello: deps.runtimeHello,
    triggerHandler: deps.triggerEventHandler,
  });
  mountScheduleFiredRoute(app, {
    db: deps.db,
    k8s: deps.k8s,
    runtimeMutator: deps.runtimeMutator,
  });

  return app;
}
