import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { CoreV1Api } from "@kubernetes/client-node";
import type {
  AgentsService,
  ArtifactTouchService,
  ConnectionsService,
  RuntimeDeliveryService,
  SessionDirectoryService,
} from "api-server-api";
import type { Db } from "db";
import type { OnboardingMarker } from "../../modules/starter-kits/services/onboarding-marker.js";
import type { OnboardingChecklistOps } from "../../modules/starter-kits/services/onboarding-checklist.js";
import type {
  AgentsRepository,
  RuntimeProgressPort,
} from "../../modules/agents/index.js";
import type { SatellitesComposition } from "../../modules/satellites/index.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import type { AgentStateCache } from "../../modules/agents/infrastructure/agent-state-cache.js";
import {
  composeSchedulesForOwner,
  type SchedulesBoot,
} from "../../modules/schedules/index.js";
import type { ArtifactLibraryFor } from "../../modules/artifact-library/index.js";
import {
  composeExperimentsForOwner,
  type ExperimentPinPort,
} from "../../modules/experiments/index.js";
import {
  composeInvocationsForOwner,
  createTargetAdmission,
} from "../../modules/invocations/index.js";
import {
  composeBudgetsModule,
  composeSpawnSizeGate,
} from "../../modules/budgets/index.js";
import type { ArtifactService } from "../../modules/artifacts/services/artifact-service.js";
import {
  composeKbPublishGate,
  composeKbShareAgentOps,
  composeKbShareServing,
} from "../../modules/kb-shares/index.js";
import { createConnectionsRepository } from "../../modules/connections/infrastructure/connections-repository.js";
import { createKubernetesSecretStore } from "../../modules/secret-store/index.js";
import { composeSkillsModule } from "../../modules/skills/compose.js";
import type { TemplatesRepository } from "../../modules/templates/infrastructure/templates-repository.js";
import type { SkillSourceSeed } from "../../modules/skills/index.js";
import { mountMcpRoutes } from "./mcp-endpoint.js";
import { mountAgentKbRoutes } from "./kb-endpoint.js";
import { mountRuntimeTrpc } from "./runtime-trpc.js";
import { mountInvocationRoutes } from "./invocation-endpoints.js";
import { mountExperimentRoutes } from "./experiment-endpoints.js";
import { createAgentImageReader } from "./agent-image.js";
import type { Config } from "../../config.js";
import type { ChannelManager } from "./../../modules/channels/services/channel-manager.js";
import type { RuntimeMutator } from "../../modules/runtime-delivery/index.js";
import type {
  CaseStudyInspectionService,
  CaseStudySubmissionsService,
} from "../../modules/case-studies/index.js";
import type { AgentTelemetryService } from "../../modules/metrics/index.js";

export interface HarnessApiServerAppDeps {
  agentStateCache: AgentStateCache;
  config: Config;
  api: CoreV1Api;
  db: Db;
  channelManager: ChannelManager;
  seedSources: SkillSourceSeed[];
  runtimeHello: RuntimeDeliveryService;
  sessionDirectory: SessionDirectoryService;
  schedulesBoot: SchedulesBoot;
  runtimeMutator: RuntimeMutator;
  artifacts: ArtifactService;
  k8sClient: K8sClient;
  agentsRepo: AgentsRepository;
  templatesRepo: TemplatesRepository;
  artifactLibraryFor: ArtifactLibraryFor;
  experimentPin: ExperimentPinPort;
  agentsServiceFor: (owner: string) => AgentsService;
  connectionsServiceFor: (owner: string) => ConnectionsService;
  caseStudySubmissions: CaseStudySubmissionsService;
  caseStudyInspection: CaseStudyInspectionService;
  carriesInspectorRole: (sub: string) => Promise<boolean>;
  agentTelemetry: AgentTelemetryService;
  wakeAgent: (agentId: string) => Promise<void>;
  markOnboardingComplete: OnboardingMarker;
  onboardingChecklist: OnboardingChecklistOps;
  runtimeProgress: RuntimeProgressPort;
  satellitesBoot: SatellitesComposition;
}

export function startHarnessApiServerApp(deps: HarnessApiServerAppDeps) {
  const {
    config,
    api,
    db,
    channelManager,
    seedSources,
    runtimeHello,
    sessionDirectory,
    schedulesBoot,
    runtimeMutator,
    artifacts,
    k8sClient,
    agentsRepo,
    templatesRepo,
    artifactLibraryFor,
    experimentPin,
    agentsServiceFor,
    connectionsServiceFor,
    markOnboardingComplete,
    onboardingChecklist,
    caseStudySubmissions,
    caseStudyInspection,
    carriesInspectorRole,
    agentTelemetry,
    wakeAgent,
    runtimeProgress,
  } = deps;

  const defaultLimits = {
    cpu: config.agentDefaultCpuLimit,
    memory: config.agentDefaultMemoryLimit,
  };
  const defaultCeiling = {
    cpu: config.defaultUserCpuBudget,
    memory: config.defaultUserMemoryBudget,
  };
  const publishLimits = {
    perFileMaxBytes: config.kbSharePerFileMaxBytes,
    totalMaxBytes: config.kbShareTotalMaxBytes,
    maxFiles: config.kbShareMaxFiles,
  };

  const invocationsServiceFor = (owner: string) =>
    composeInvocationsForOwner({
      db,
      owner,
      agents: agentsServiceFor(owner),
      runtimeMutator,
      wakeAgent,
      targetAdmission: createTargetAdmission({
        readTemplateResources: async (templateId) =>
          (await templatesRepo.readSpec(templateId))?.spec.resources,
        defaultLimits,
        gate: composeSpawnSizeGate({
          k8s: k8sClient,
          owner,
          defaultCeiling,
        }),
      }),
    });

  const mcpArtifactLibraryFor = (owner: string) =>
    artifactLibraryFor(owner, "mcp");

  const kbShareOpsFor = (owner: string) =>
    composeKbShareAgentOps({
      owner,
      db,
      agents: agentsServiceFor(owner),
      namespace: config.namespace,
      store: artifacts,
      ensureReady: (agentId) => agentsRepo.ensureReady(agentId),
      workspace: {
        agentHome: config.agentHome,
        agentWorkDir: config.agentWorkDir,
      },
      objectStoreConfigured: Boolean(config.objectStorageEndpoint),
      publishLimits,
    });

  const connectionsRepo = createConnectionsRepository(db);
  const secretStore = createKubernetesSecretStore({ k8s: k8sClient });
  const kbMcp = composeKbShareServing({
    db,
    store: artifacts,
    k8s: k8sClient,
    grepDeadlineMs: config.kbShareGrepDeadlineMs,
  });
  const kbPublishGate = composeKbPublishGate({
    db,
    store: artifacts,
    publishLimits,
  });

  const composeSkills = (owner: string) =>
    composeSkillsModule({
      agentStateCache: deps.agentStateCache,
      surface: "mcp",
      api,
      namespace: config.namespace,
      owner,
      db,
      seedSources,
      brandName: config.brand.name,
      runtimeMutator,
      templatesRepo,
      runtimeProgress,
    });
  const experimentsServiceFor = (owner: string) =>
    composeExperimentsForOwner({
      db,
      owner,
      surface: "mcp",
      artifactLibrary: mcpArtifactLibraryFor(owner),
      pin: experimentPin,
      agents: agentsServiceFor(owner),
    }).experiments;

  const app = new Hono();
  mountMcpRoutes(app, {
    channelManager,
    k8s: k8sClient,
    composeSkills,
    schedulesServiceFor: (owner) =>
      composeSchedulesForOwner({
        boot: schedulesBoot,
        owner,
        agentBinding: "*",
      }).schedules,
    markOnboardingComplete,
    onboardingChecklist,
    artifactLibraryFor: mcpArtifactLibraryFor,
    invocationsServiceFor,
    experimentsServiceFor,
    kbShareOpsFor,
    agentHome: config.agentHome,
    caseStudySubmissions,
    caseStudyInspection,
    carriesInspectorRole,
    agentImage: createAgentImageReader(k8sClient),
    agentTelemetry,
    satelliteOps: deps.satellitesBoot.agentOps,
    satelliteWaitDeadlineMs: config.satelliteWaitDeadlineMs,
  });
  mountAgentKbRoutes(app, {
    k8s: k8sClient,
    kbMcp,
    connections: connectionsRepo,
    secretStore,
  });
  mountInvocationRoutes(app, {
    k8s: k8sClient,
    invocationsServiceFor,
    connectionsServiceFor,
    templates: templatesRepo,
    budgetsFor: (owner) =>
      composeBudgetsModule({
        k8s: k8sClient,
        owner,
        listAgents: () => agentsRepo.list(owner),
        defaultCeiling,
        slotSize: defaultLimits,
      }).budgets,
    defaultLimits,
  });
  mountExperimentRoutes(app, { k8s: k8sClient, experimentsServiceFor });
  mountRuntimeTrpc(app, {
    k8s: k8sClient,
    hello: runtimeHello,
    sessionDirectory,
    artifactTouchesFor: (owner): ArtifactTouchService => ({
      recordTouch: (input) => mcpArtifactLibraryFor(owner).recordTouch(input),
    }),
    kbPublish: kbPublishGate,
  });

  const server = serve(
    { fetch: app.fetch, port: config.harnessServerPort },
    () => {
      process.stderr.write(
        `harness-api listening on http://localhost:${config.harnessServerPort}\n`,
      );
    },
  );

  server.on("upgrade", (_req, socket) => {
    socket.destroy();
  });

  return { server };
}
