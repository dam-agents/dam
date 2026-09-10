import { serve } from "@hono/node-server";
import type {
  AgentsService,
  ConnectionsService,
  RuntimeDeliveryService,
  SessionDirectoryService,
} from "api-server-api";
import type { Db } from "db";
import type { RuntimeProgressPort } from "../../modules/agents/index.js";
import type { AgentStore } from "../../modules/agents/infrastructure/agent-store.js";
import type { SandboxAddresses } from "../../modules/agents/infrastructure/sandbox-addresses.js";
import { createAgentsRepository } from "../../modules/agents/infrastructure/agents-repository.js";
import { EXPERIMENT_ACTIVE_KEY } from "../../modules/agents/infrastructure/labels.js";
import {
  composeSchedulesForOwner,
  type SchedulesBoot,
} from "../../modules/schedules/index.js";
import { composeArtifactLibraryForOwner } from "../../modules/artifact-library/index.js";
import { composeExperimentsForOwner } from "../../modules/experiments/index.js";
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
import { createFileSecretStore } from "../../modules/secret-store/index.js";
import { composeSkillsModule } from "../../modules/skills/compose.js";
import { createTemplatesRepository } from "../../modules/templates/infrastructure/templates-repository.js";
import { composeTemplatesModule } from "../../modules/templates/compose.js";
import type { SkillSourceSeed } from "../../modules/skills/index.js";
import { createHarnessRouter } from "./harness-router.js";
import { createAgentImageReader } from "./agent-image.js";
import type { Config } from "../../config.js";
import type { ChannelManager } from "./../../modules/channels/services/channel-manager.js";
import type { RuntimeMutator } from "../../modules/runtime-delivery/index.js";
import type {
  CaseStudyInspectionService,
  CaseStudySubmissionsService,
} from "../../modules/case-studies/index.js";
import type { AgentUsageSummaryService } from "../../modules/metrics/index.js";

export interface HarnessApiServerAppDeps {
  agentStore: AgentStore;
  sandboxAddresses: SandboxAddresses;
  config: Config;
  db: Db;
  channelManager: ChannelManager;
  seedSources: SkillSourceSeed[];
  runtimeHello: RuntimeDeliveryService;
  sessionDirectory: SessionDirectoryService;
  schedulesBoot: SchedulesBoot;
  runtimeMutator: RuntimeMutator;
  artifacts: ArtifactService;
  agentsServiceFor: (owner: string) => AgentsService;
  connectionsServiceFor: (owner: string) => ConnectionsService;
  caseStudySubmissions: CaseStudySubmissionsService;
  caseStudyInspection: CaseStudyInspectionService;
  carriesInspectorRole: (sub: string) => Promise<boolean>;
  usageSummary: AgentUsageSummaryService;
  wakeAgent: (agentId: string) => Promise<void>;
  runtimeProgress: RuntimeProgressPort;
}

export function startHarnessApiServerApp(deps: HarnessApiServerAppDeps) {
  const {
    config,
    db,
    channelManager,
    seedSources,
    runtimeHello,
    sessionDirectory,
    schedulesBoot,
    runtimeMutator,
    artifacts,
    agentsServiceFor,
    connectionsServiceFor,
    caseStudySubmissions,
    caseStudyInspection,
    carriesInspectorRole,
    usageSummary,
    wakeAgent,
    runtimeProgress,
  } = deps;

  const templatesRepo = createTemplatesRepository(config.agentTemplatesPath);
  const { templates } = composeTemplatesModule(templatesRepo);

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
        defaultLimits: {
          cpu: config.agentDefaultCpuLimit,
          memory: config.agentDefaultMemoryLimit,
        },
        gate: composeSpawnSizeGate({
          db,
          owner,
          defaultCeiling: {
            cpu: config.defaultUserCpuBudget,
            memory: config.defaultUserMemoryBudget,
          },
        }),
      }),
    });

  const artifactLibraryFor = (owner: string) =>
    composeArtifactLibraryForOwner({
      db,
      artifacts,
      owner,
      surface: "mcp",
      shareBaseUrl: config.shareBaseUrl,
    }).artifactLibrary;

  const harnessAgentsRepo = createAgentsRepository(deps.agentStore);
  const kbShareOpsFor = (owner: string) =>
    composeKbShareAgentOps({
      owner,
      db,
      agents: agentsServiceFor(owner),
      sandboxAddresses: deps.sandboxAddresses,
      store: artifacts,
      ensureReady: (agentId) => harnessAgentsRepo.ensureReady(agentId),
      workspace: {
        agentHome: config.agentHome,
        agentWorkDir: config.agentWorkDir,
      },
      objectStoreConfigured: Boolean(config.objectStorageEndpoint),
      publishLimits: {
        perFileMaxBytes: config.kbSharePerFileMaxBytes,
        totalMaxBytes: config.kbShareTotalMaxBytes,
        maxFiles: config.kbShareMaxFiles,
      },
    });
  const experimentPin = {
    set: (agentId: string) =>
      harnessAgentsRepo.patchAnnotation(agentId, EXPERIMENT_ACTIVE_KEY, "true"),
    clear: (agentId: string) =>
      harnessAgentsRepo.patchAnnotation(agentId, EXPERIMENT_ACTIVE_KEY, ""),
  };

  const connectionsRepo = createConnectionsRepository(db);
  const secretStore = createFileSecretStore({ root: config.secretStoreRoot });
  const kbMcp = composeKbShareServing({
    db,
    store: artifacts,
    agentStore: deps.agentStore,
    grepDeadlineMs: config.kbShareGrepDeadlineMs,
  });
  const kbPublishGate = composeKbPublishGate({
    db,
    store: artifacts,
    publishLimits: {
      perFileMaxBytes: config.kbSharePerFileMaxBytes,
      totalMaxBytes: config.kbShareTotalMaxBytes,
      maxFiles: config.kbShareMaxFiles,
    },
  });

  const app = createHarnessRouter({
    channelManager,
    agentStore: deps.agentStore,
    addresses: deps.sandboxAddresses,
    runtimeHello,
    sessionDirectory,
    kbPublishGate,
    composeSkills: (owner) =>
      composeSkillsModule({
        agentStore: deps.agentStore,
        sandboxAddresses: deps.sandboxAddresses,
        surface: "mcp",
        owner,
        db,
        seedSources,
        brandName: config.brand.name,
        runtimeMutator,
        templatesRepo,
        runtimeProgress,
      }),
    schedulesServiceFor: (owner) =>
      composeSchedulesForOwner({
        boot: schedulesBoot,
        owner,
        agentBinding: "*",
      }).schedules,
    experimentsServiceFor: (owner) =>
      composeExperimentsForOwner({
        db,
        owner,
        surface: "mcp",
        artifactLibrary: artifactLibraryFor(owner),
        pin: experimentPin,
        agents: agentsServiceFor(owner),
      }).experiments,
    artifactLibraryFor,
    invocationsServiceFor,
    connectionsServiceFor,
    kbShareOpsFor,
    agentHome: config.agentHome,
    agentKb: {
      agentStore: deps.agentStore,
      kbMcp,
      connections: connectionsRepo,
      secretStore,
    },
    caseStudySubmissions,
    caseStudyInspection,
    carriesInspectorRole,
    agentImage: createAgentImageReader(deps.agentStore),
    usageSummary,
    templates,
    budgetsFor: (owner) =>
      composeBudgetsModule({
        db,
        owner,
        listAgents: () => harnessAgentsRepo.list(owner),
        defaultCeiling: {
          cpu: config.defaultUserCpuBudget,
          memory: config.defaultUserMemoryBudget,
        },
        slotSize: {
          cpu: config.agentDefaultCpuLimit,
          memory: config.agentDefaultMemoryLimit,
        },
      }).budgets,
    defaultLimits: {
      cpu: config.agentDefaultCpuLimit,
      memory: config.agentDefaultMemoryLimit,
    },
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
