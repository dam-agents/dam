import { Hono } from "hono";
import type {
  BudgetsService,
  ConnectionsService,
  ExperimentsService,
  FeaturesService,
  SchedulesService,
  SkillsService,
  RuntimeDeliveryService,
  TemplatesService,
} from "api-server-api";
import type { DefaultResourceLimits } from "../../modules/agents/index.js";
import { mountMcpRoutes } from "./mcp-endpoint.js";
import { mountRuntimeTrpc } from "./runtime-trpc.js";
import { mountInvocationRoutes } from "./invocation-endpoints.js";
import { mountExperimentRoutes } from "./experiment-endpoints.js";
import type { ChannelManager } from "./../../modules/channels/services/channel-manager.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import type {
  ArtifactLibraryServiceImpl,
  ArtifactRequestsServiceImpl,
} from "../../modules/artifact-library/index.js";
import type { InvocationsService } from "../../modules/invocations/index.js";

export function createHarnessRouter(deps: {
  channelManager: ChannelManager;
  k8s: K8sClient;
  composeSkills: (owner: string) => SkillsService;
  schedulesServiceFor: (owner: string) => SchedulesService;
  experimentsServiceFor: (owner: string) => ExperimentsService;
  artifactLibraryFor: (owner: string) => ArtifactLibraryServiceImpl;
  artifactRequestsServiceFor: (owner: string) => ArtifactRequestsServiceImpl;
  featuresServiceFor: (owner: string) => FeaturesService;
  invocationsServiceFor: (owner: string) => InvocationsService;
  connectionsServiceFor: (owner: string) => ConnectionsService;
  templates: TemplatesService;
  budgetsFor: (owner: string) => BudgetsService;
  defaultLimits: DefaultResourceLimits;
  runtimeHello: RuntimeDeliveryService;
}) {
  const app = new Hono();

  mountMcpRoutes(app, {
    channelManager: deps.channelManager,
    k8s: deps.k8s,
    composeSkills: deps.composeSkills,
    schedulesServiceFor: deps.schedulesServiceFor,
    artifactLibraryFor: deps.artifactLibraryFor,
    artifactRequestsServiceFor: deps.artifactRequestsServiceFor,
    featuresServiceFor: deps.featuresServiceFor,
    invocationsServiceFor: deps.invocationsServiceFor,
    experimentsServiceFor: deps.experimentsServiceFor,
  });
  mountInvocationRoutes(app, {
    k8s: deps.k8s,
    invocationsServiceFor: deps.invocationsServiceFor,
    connectionsServiceFor: deps.connectionsServiceFor,
    templates: deps.templates,
    budgetsFor: deps.budgetsFor,
    defaultLimits: deps.defaultLimits,
  });
  mountExperimentRoutes(app, {
    k8s: deps.k8s,
    experimentsServiceFor: deps.experimentsServiceFor,
  });
  mountRuntimeTrpc(app, {
    k8s: deps.k8s,
    hello: deps.runtimeHello,
  });

  return app;
}
