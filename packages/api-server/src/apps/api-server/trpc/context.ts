import type { ApiContext, UserIdentity } from "api-server-api";
import { ChannelType } from "api-server-api";
import {
  composeAgentsModule,
  connectionGrantProvisioner,
} from "../../../modules/agents/index.js";
import { ANN_STARTER_KIT_ONBOARDED } from "../../../modules/agents/infrastructure/labels.js";
import { composeHarnessConfigModule } from "../../../modules/harness-config/index.js";
import { composeBudgetsModule } from "../../../modules/budgets/index.js";
import {
  createDisabledMetricsService,
  createMetricsService,
  createSessionTypeSpend,
} from "../../../modules/metrics/index.js";
import {
  createDisabledTelemetryService,
  createTelemetryService,
  scopeOwnedAgentIds,
} from "../../../modules/telemetry/index.js";
import { composeSchedulesForOwner } from "../../../modules/schedules/index.js";
import {
  composeInvocationsQueryForOwner,
  isInvocationTargetName,
} from "../../../modules/invocations/index.js";
import { composeStarterKitsForOwner } from "../../../modules/starter-kits/index.js";
import { composeKbSharesForOwner } from "../../../modules/kb-shares/index.js";
import { composeCaseStudiesForOwner } from "../../../modules/case-studies/index.js";
import { composeExperimentsForOwner } from "../../../modules/experiments/index.js";
import { composeFeaturesForOwner } from "../../../modules/features/index.js";
import { composeSkillsModule } from "../../../modules/skills/compose.js";
import { composeFilesModule } from "../../../modules/files/files-service.js";
import { composeConnectionsForOwner } from "../../../modules/connections/compose.js";
import { composeApprovalsService } from "../../../modules/approvals/compose.js";
import { composeAttentionService } from "../../../modules/attention/compose.js";
import { createApprovalsRepository } from "../../../modules/approvals/infrastructure/approvals-repository.js";
import { composeUsageForOwner } from "../../../modules/usage/compose.js";
import {
  composeEgressRulesModule,
  createAgentL7HostsPort,
  createConnectionRulesSyncAdapter,
  createEgressRuleWriterAdapter,
} from "../../../modules/egress-rules/compose.js";
import {
  findAgentByConversation,
  bindConversation,
  unbindConversation,
} from "../../../modules/channels/infrastructure/telegram-conversations-repository.js";
import type { ApiServerDeps } from "../deps.js";

export function createApiContextFactory(boot: ApiServerDeps) {
  const {
    config,
    api,
    db,
    channelManager,
    telegramBindFlows,
    slackBindFlows,
    seedSources,
    wrapperFrameSender,
    presetSeeder,
    trustedHosts,
    agentCleanupHooks,
    secretStores,
    runtimeMutator,
    contributionsProgress,
    onboardingChecklists,
    getAgentCapabilities,
    schedulesBoot,
    listRegisteredAgentIds,
    metricsReader,
    telemetryReader,
    sessionDirectory,
    terms,
    e2e,
    artifacts,
    k8sClient,
    agentsRepo,
    templatesRepo,
    starterKitsRepo,
    reposService,
    connectionsBoot,
    apiKeysModule,
    satellitesBoot,
    liveEvents,
    wakeAgent,
    experimentPin,
    artifactLibraryFor,
  } = boot;

  const defaultLimits = {
    cpu: config.agentDefaultCpuLimit,
    memory: config.agentDefaultMemoryLimit,
  };

  return (user: UserIdentity, surface: string): ApiContext => {
    const connections = composeConnectionsForOwner({
      ownerId: user.sub,
      maxSharedKbConnections: config.kbShareMaxConnectionsPerOwner,
      db,
      templates: connectionsBoot.templates,
      oauthEngine: connectionsBoot.oauthEngine,
      githubAppEngine: connectionsBoot.githubAppEngine,
      secretStore: secretStores.default(),
      runtimeMutator,
      agentsRepo,
      connectionRulesSync: createConnectionRulesSyncAdapter(db),
      oauthCallbackUrl: `${config.uiBaseUrl}/api/oauth/callback`,
      brandName: config.brand.name,
    });
    const { budgets, resizeGate } = composeBudgetsModule({
      k8s: k8sClient,
      owner: user.sub,
      listAgents: () => agentsRepo.list(user.sub),
      defaultCeiling: {
        cpu: config.defaultUserCpuBudget,
        memory: config.defaultUserMemoryBudget,
      },
      slotSize: defaultLimits,
    });
    const { agents, isOwnedAgent } = composeAgentsModule({
      api,
      resolveSlackWorkspace: boot.resolveSlackWorkspace,
      agentStateCache: boot.agentStateCache,
      namespace: config.namespace,
      agentIdleTimeoutMinutes: config.agentIdleTimeoutMinutes,
      agentDefaultLimits: defaultLimits,
      virtualizationEnabled: config.virtualizationEnabled,
      resizeGate,
      owner: user.sub,
      db,
      telegramBinding: telegramBindFlows
        ? {
            peekFlow: telegramBindFlows.peek,
            consumeFlow: telegramBindFlows.consume,
            findAgentByConversation: findAgentByConversation(db),
            bind: bindConversation(db),
            postMessage: (agentId, conversationId, text) =>
              channelManager.postMessage(agentId, ChannelType.Telegram, text, {
                conversationId,
              }),
            listConversations: (agentId) =>
              channelManager.listConversations(agentId, ChannelType.Telegram),
            unbind: unbindConversation(db),
          }
        : undefined,
      slackBinding: {
        peekFlow: slackBindFlows.peek,
        consumeFlow: slackBindFlows.consume,
        postMessage: (agentId, slackChannelId, text) =>
          channelManager.postMessage(agentId, ChannelType.Slack, text, {
            conversationId: slackChannelId,
          }),
      },
      resolveSlackChannelNames: (refs) =>
        channelManager.resolveSlackConversationNames(refs),
      readTemplateSpec: templatesRepo.readSpec,
      presetSeeder,
      cleanupHooks: agentCleanupHooks,
      runtimeMutator,
      contributionsProgress,
      onboardingChecklists,
      grantProvisioner: connectionGrantProvisioner(connections),
    });
    const agentExists = async (agentId: string) =>
      (await agents.get(agentId)) !== null;
    const { schedules } = composeSchedulesForOwner({
      boot: schedulesBoot,
      owner: user.sub,
      agentBinding: user.agentIds,
      agentExists,
    });
    const invocationsQuery = composeInvocationsQueryForOwner({
      db,
      owner: user.sub,
    });
    const { kbShares } = composeKbSharesForOwner({
      owner: user.sub,
      db,
      agents,
      namespace: config.namespace,
      store: artifacts,
      ensureReady: (agentId) => agentsRepo.ensureReady(agentId),
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
    const artifactLibrary = artifactLibraryFor(user.sub, surface, {
      agentExists,
    });
    const { experiments } = composeExperimentsForOwner({
      db,
      owner: user.sub,
      surface,
      artifactLibrary,
      agents,
      pin: experimentPin,
      runtimeMutator,
      wakeAgent,
    });
    const { features } = composeFeaturesForOwner({
      db,
      owner: user.sub,
      surface,
    });
    const skills = composeSkillsModule({
      agentStateCache: boot.agentStateCache,
      surface,
      api,
      namespace: config.namespace,
      owner: user.sub,
      db,
      seedSources,
      brandName: config.brand.name,
      runtimeMutator,
      templatesRepo,
      runtimeProgress: contributionsProgress,
    });
    const { starterKits } = composeStarterKitsForOwner({
      owner: user.sub,
      repo: starterKitsRepo,
      agents,
      schedules,
      connections,
      skills,
      surface,
      readTemplateSpec: templatesRepo.readSpec,
      wakeAgent,
      markAgentOnboarded: (agentId, at) =>
        agentsRepo.patchAnnotation(agentId, ANN_STARTER_KIT_ONBOARDED, at),
      runtimeMutator,
      virtualizationEnabled: config.virtualizationEnabled,
    });
    const isAgentOwnedBy = async (agentId: string, ownerSub: string) =>
      (await agentExists(agentId)) && ownerSub === user.sub;
    const l7Hosts = createAgentL7HostsPort(k8sClient);
    const { service: egressRules } = composeEgressRulesModule({
      db,
      ownerSub: user.sub,
      isAgentOwnedBy,
      l7Hosts,
      presetSeeder,
      trustedHosts,
    });
    const { service: approvals } = composeApprovalsService({
      db,
      ownerSub: user.sub,
      agentBinding: user.agentIds,
      isAgentOwnedBy: (agentId, ownerSub) =>
        agentsRepo.isOwnedBy(agentId, ownerSub),
      egressRuleWriter: createEgressRuleWriterAdapter(db, l7Hosts),
      wrapperFrameSender,
    });
    const attention = composeAttentionService({
      db,
      ownerSub: user.sub,
      ownsApproval: async (approvalId) =>
        (await createApprovalsRepository(db).getPending(approvalId))
          ?.ownerSub === user.sub,
    });
    const files = composeFilesModule(
      agentsRepo,
      config.namespace,
      user.sub,
      surface,
    );
    const apiKeys = apiKeysModule.createService({
      ownerSub: user.sub,
      surface,
    });
    const satellites = satellitesBoot.serviceFor(user.sub, user.agentIds);
    const { service: harnessConfig } = composeHarnessConfigModule({
      db,
      ownerSub: user.sub,
      surface,
      runtimeMutator,
      isOwnedAgent,
      getCapabilities: getAgentCapabilities,
      isSettled: (agentId) =>
        contributionsProgress.progress(agentId).then((p) => p.settled),
    });
    const listOwnedAgents = async (): Promise<
      { id: string; name: string | null }[]
    > => {
      const [live, registered] = await Promise.all([
        agents.list(),
        listRegisteredAgentIds(user.sub),
      ]);
      const names = new Map(live.map((a) => [a.id, a.name]));
      const scoped = scopeOwnedAgentIds({
        liveIds: [...names.keys()],
        registeredIds: registered,
        granted: user.agentIds,
      });
      return scoped.map((id) => ({ id, name: names.get(id) ?? null }));
    };
    const { caseStudies } = composeCaseStudiesForOwner({
      db,
      owner: user.sub,
      listOwnedAgentIds: async () => (await listOwnedAgents()).map((a) => a.id),
      readArtifactText: async (artifactId) => {
        const artifact = await artifactLibrary.getContent(artifactId);
        if (!artifact || artifact.binary || artifact.tooLarge) return null;
        return artifact.content;
      },
    });
    const metrics = metricsReader
      ? createMetricsService({
          reader: metricsReader,
          listOwnedAgents,
          isInvocationTargetName,
          sessionTypeSpend: createSessionTypeSpend({
            readSpend: (agentIds, window) =>
              metricsReader.spendBySession(agentIds, window),
            categorizeSessions: (agentIds, sessionIds) =>
              sessionDirectory.categorize(agentIds, sessionIds),
            isEnabled: async () =>
              (await features.flags())["session-costs"] ?? false,
          }),
        })
      : createDisabledMetricsService();
    const telemetry = telemetryReader
      ? createTelemetryService({ reader: telemetryReader, listOwnedAgents })
      : createDisabledTelemetryService();

    return {
      templates: templatesRepo,
      repos: reposService,
      agents,
      schedules,
      channels: {
        available: channelManager.availableChannels(),
        telegramBotUsername: () => channelManager.telegramBotUsername(),
      },
      connections,
      skills,
      approvals,
      attention,
      egressRules,
      experiments,
      invocationsQuery,
      starterKits,
      kbShares,
      artifactLibrary,
      caseStudies,
      features,
      files,
      harnessConfig,
      links: config.links,
      liveEvents,
      metrics,
      telemetry,
      terms,
      usage: composeUsageForOwner(user.sub),
      e2e,
      apiKeys,
      satellites,
      satelliteWorker: satellitesBoot.workerOps,
      budgets,
      user,
      e2eEnabled: config.e2eEnabled,
      virtualizationEnabled: config.virtualizationEnabled,
    };
  };
}
