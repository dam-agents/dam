import { Hono } from "hono";
import type {
  ExperimentsService,
  SchedulesService,
  SkillsService,
  RuntimeDeliveryService,
} from "api-server-api";
import { mountMcpRoutes } from "./mcp-endpoint.js";
import { mountRuntimeTrpc } from "./runtime-trpc.js";
import type { ChannelManager } from "./../../modules/channels/services/channel-manager.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import type { ArtifactService } from "../../modules/artifacts/services/artifact-service.js";

export function createHarnessRouter(deps: {
  channelManager: ChannelManager;
  k8s: K8sClient;
  composeSkills: (owner: string) => SkillsService;
  agentHome: string;
  schedulesServiceFor: (owner: string) => SchedulesService;
  experimentsServiceFor: (owner: string) => ExperimentsService;
  artifacts: ArtifactService;
  runtimeHello: RuntimeDeliveryService;
}) {
  const app = new Hono();

  mountMcpRoutes(app, {
    channelManager: deps.channelManager,
    k8s: deps.k8s,
    composeSkills: deps.composeSkills,
    agentHome: deps.agentHome,
    schedulesServiceFor: deps.schedulesServiceFor,
    experimentsServiceFor: deps.experimentsServiceFor,
    artifacts: deps.artifacts,
  });
  mountRuntimeTrpc(app, {
    k8s: deps.k8s,
    hello: deps.runtimeHello,
  });

  return app;
}
