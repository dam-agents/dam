import { Hono } from "hono";
import type {
  ConnectionsService,
  ExperimentsService,
  SchedulesService,
  SkillsService,
  RuntimeDeliveryService,
  TemplatesService,
} from "api-server-api";
import { mountMcpRoutes } from "./mcp-endpoint.js";
import { mountRuntimeTrpc } from "./runtime-trpc.js";
import { mountSandboxRoutes } from "./sandbox-endpoints.js";
import type { ChannelManager } from "./../../modules/channels/services/channel-manager.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import type { ArtifactService } from "../../modules/artifacts/services/artifact-service.js";
import type { ArtifactLibraryServiceImpl } from "../../modules/artifact-library/index.js";
import type { SandboxesService } from "../../modules/sandboxes/index.js";

export function createHarnessRouter(deps: {
  channelManager: ChannelManager;
  k8s: K8sClient;
  composeSkills: (owner: string) => SkillsService;
  agentHome: string;
  schedulesServiceFor: (owner: string) => SchedulesService;
  experimentsServiceFor: (owner: string) => ExperimentsService;
  artifactLibraryFor: (owner: string) => ArtifactLibraryServiceImpl;
  isArtifactsFeatureEnabled: (owner: string) => Promise<boolean>;
  sandboxesServiceFor: (owner: string) => SandboxesService;
  connectionsServiceFor: (owner: string) => ConnectionsService;
  templates: TemplatesService;
  artifacts: ArtifactService;
  maxArtifactBytes: number;
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
    artifactLibraryFor: deps.artifactLibraryFor,
    isArtifactsFeatureEnabled: deps.isArtifactsFeatureEnabled,
    sandboxesServiceFor: deps.sandboxesServiceFor,
    artifacts: deps.artifacts,
    maxArtifactBytes: deps.maxArtifactBytes,
  });
  mountSandboxRoutes(app, {
    k8s: deps.k8s,
    sandboxesServiceFor: deps.sandboxesServiceFor,
    connectionsServiceFor: deps.connectionsServiceFor,
    templates: deps.templates,
  });
  mountRuntimeTrpc(app, {
    k8s: deps.k8s,
    hello: deps.runtimeHello,
  });

  return app;
}
