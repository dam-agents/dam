import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { CoreV1Api } from "@kubernetes/client-node";
import type {
  AgentsService,
  ArtifactTouchService,
  ConnectionsService,
  HarnessCatalog,
  RuntimeDeliveryService,
  SessionDirectoryService,
  SpendStatus,
  ToolApprovalReports,
} from "api-server-api";
import type { Db } from "db";
import type { OnboardingMarker } from "../../modules/starter-kits/services/onboarding-marker.js";
import type { OnboardingChecklistOps } from "../../modules/starter-kits/services/onboarding-checklist.js";
import type {
  AgentsRepository,
  RuntimeProgressPort,
} from "../../modules/agents/index.js";
import type { KitUpdateReporter } from "../../modules/starter-kits/services/kit-update-reporter.js";
import type { SatellitesComposition } from "../../modules/satellites/index.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import type { AgentStateCache } from "../../modules/agents/infrastructure/agent-state-cache.js";
import {
  composeSchedulesForOwner,
  type SchedulesBoot,
} from "../../modules/schedules/index.js";
import type { ArtifactLibraryFor } from "../../modules/artifact-library/index.js";
import {
  composeSubAgentAwaitMarks,
  composeInvocationsForOwner,
  createTargetAdmission,
  type DelegationFramesPort,
  type ReadHarnessConfigSupport,
  type SpendHoldGate,
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
import type { SecretStore } from "../../modules/secret-store/index.js";
import { composeSkillsModule } from "../../modules/skills/compose.js";
import type { TemplatesRepository } from "../../modules/templates/infrastructure/templates-repository.js";
import type { SkillSourceSeed } from "../../modules/skills/index.js";
import { mountMcpRoutes } from "./mcp-endpoint.js";
import { mountAgentKbRoutes } from "./kb-endpoint.js";
import { mountRuntimeTrpc } from "./runtime-trpc.js";
import { mountInvocationRoutes } from "./invocation-endpoints.js";
import {
  createDriverOps,
  driverDefaultModel,
  type DriverOpsDeps,
} from "./driver-ops.js";
import type { FirePair } from "../../modules/harness-config/index.js";
import { createAgentImageReader } from "./agent-image.js";
import {
  limitRequestBody,
  MAX_AGENT_REQUEST_BODY_BYTES,
} from "../../core/request-body-bounds.js";
import { agentsInstallSettings, type Config } from "../../config.js";
import type { ChannelManager } from "./../../modules/channels/services/channel-manager.js";
import type {
  RuntimeMutator,
  SessionMessages,
} from "../../modules/runtime-delivery/index.js";
import type {
  CaseStudyInspectionService,
  CaseStudySubmissionsService,
} from "../../modules/case-studies/index.js";
import type { AgentTelemetryService } from "../../modules/metrics/index.js";
import { composeFeaturesForOwner } from "../../modules/features/index.js";
import { createChatFormPreferencesReader } from "../../modules/chat-forms/index.js";
import type { EnvironmentsServiceImpl } from "../../modules/environments/index.js";

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
  delegationFrames: DelegationFramesPort;
  k8sClient: K8sClient;
  agentsRepo: AgentsRepository;
  templatesRepo: TemplatesRepository;
  harnessCatalog: HarnessCatalog;
  firePair: FirePair;
  artifactLibraryFor: ArtifactLibraryFor;
  agentsServiceFor: (owner: string) => AgentsService;
  environmentsFor: (owner: string) => EnvironmentsServiceImpl;
  connectionsServiceFor: (owner: string) => ConnectionsService;
  caseStudySubmissions: CaseStudySubmissionsService;
  caseStudyInspection: CaseStudyInspectionService;
  carriesInspectorRole: (sub: string) => Promise<boolean>;
  agentTelemetry: AgentTelemetryService;
  wakeAgent: (agentId: string) => Promise<void>;
  readHarnessConfigSupport: ReadHarnessConfigSupport;
  sessionMessages: SessionMessages;
  markOnboardingComplete: OnboardingMarker;
  onboardingChecklist: OnboardingChecklistOps;
  kitUpdateReporter: KitUpdateReporter;
  runtimeProgress: RuntimeProgressPort;
  satellitesBoot: SatellitesComposition;
  secretStore: SecretStore;
  spendHold: SpendHoldGate;
  spendStatusFor: (agentId: string, owner: string) => Promise<SpendStatus>;
  toolApprovalsFor: (owner: string) => ToolApprovalReports;
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
    harnessCatalog,
    firePair,
    artifactLibraryFor,
    agentsServiceFor,
    connectionsServiceFor,
    markOnboardingComplete,
    onboardingChecklist,
    kitUpdateReporter,
    caseStudySubmissions,
    caseStudyInspection,
    carriesInspectorRole,
    agentTelemetry,
    wakeAgent,
    readHarnessConfigSupport,
    runtimeProgress,
    secretStore,
    spendHold,
    spendStatusFor,
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

  const invocationsServiceFor = (owner: string) =>
    composeInvocationsForOwner({
      db,
      owner,
      agents: agentsServiceFor(owner),
      skills: composeSkills(owner),
      pinDriver: async (driverAgentId) => {
        await agentsRepo.setInvocationPin(driverAgentId);
      },
      runtimeMutator,
      wakeAgent,
      frames: deps.delegationFrames,
      readHarnessConfigSupport,
      spendHold,
      targetAdmission: createTargetAdmission({
        readTemplateResources: async (templateId) =>
          (await templatesRepo.readSpec(templateId))?.spec.resources,
        defaultLimits,
        virtualizationEnabled:
          agentsInstallSettings(config).virtualizationEnabled,
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

  const driverOpsDeps: DriverOpsDeps = {
    agents: { get: (id) => agentsRepo.get(id) },
    invocationsServiceFor,
    connectionsServiceFor,
    templates: templatesRepo,
    harnesses: harnessCatalog,
    defaultModel: driverDefaultModel(firePair),
    budgetsFor: (owner) =>
      composeBudgetsModule({
        k8s: k8sClient,
        owner,
        listAgents: () => agentsRepo.list(owner),
        defaultCeiling,
        slotSize: defaultLimits,
        isSlackUnlinked: async () => false,
        vmPool: {
          storage: config.vmPoolStorage,
          memory: config.vmPoolMemory,
        },
      }).budgets,
    defaultLimits,
  };

  const readChatFormPreferences = createChatFormPreferencesReader(db);
  const app = new Hono();
  app.use(limitRequestBody(MAX_AGENT_REQUEST_BODY_BYTES));
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
    kitUpdateReporter,
    artifactLibraryFor: mcpArtifactLibraryFor,
    invocationsServiceFor,
    driverOpsFor: createDriverOps(driverOpsDeps),
    subAgentAwaitsFor: composeSubAgentAwaitMarks(db),
    kbShareOpsFor,
    agentHome: config.agentHome,
    caseStudySubmissions,
    caseStudyInspection,
    carriesInspectorRole,
    chatFormPreferences: (owner, agentId) =>
      readChatFormPreferences(
        agentId,
        async () =>
          (
            await composeFeaturesForOwner({
              db,
              owner,
              surface: "mcp",
              modes: config.featureModes,
            }).features.flags()
          )["chat-forms"],
      ),
    agentImage: createAgentImageReader(k8sClient),
    environments: async (owner, agentId) => {
      const flags = await composeFeaturesForOwner({
        db,
        owner,
        surface: "mcp",
        modes: config.featureModes,
      }).features.flags();
      if (!flags.environments) return null;
      const agent = await agentsRepo.get(agentId, owner);
      if (agent?.spec.backend?.type !== "vm" || agent.spec.environmentOf)
        return null;
      return deps.environmentsFor(owner).forOwningAgent(agentId);
    },
    agentTelemetry,
    spendStatusFor,
    satelliteOps: deps.satellitesBoot.agentOps,
    satelliteWaitDeadlineMs: config.satelliteWaitDeadlineMs,
    sessionMessages: deps.sessionMessages,
  });
  mountAgentKbRoutes(app, {
    k8s: k8sClient,
    kbMcp,
    connections: connectionsRepo,
    secretStore,
  });
  mountInvocationRoutes(app, { k8s: k8sClient, ...driverOpsDeps });
  mountRuntimeTrpc(app, {
    k8s: k8sClient,
    hello: runtimeHello,
    sessionDirectory,
    artifactTouchesFor: (owner): ArtifactTouchService => ({
      recordTouch: (input) => mcpArtifactLibraryFor(owner).recordTouch(input),
    }),
    kbPublish: kbPublishGate,
    toolApprovalsFor: deps.toolApprovalsFor,
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
