import type { ApiContext, UserIdentity } from "api-server-api";
import { ChannelType } from "api-server-api";
import { composeAgentsModule } from "../../../modules/agents/index.js";
import { EXPERIMENT_ACTIVE_KEY } from "../../../modules/agents/infrastructure/labels.js";
import { composeHarnessConfigModule } from "../../../modules/harness-config/index.js";
import { composeBudgetsModule } from "../../../modules/budgets/index.js";
import { composeTemplatesModule } from "../../../modules/templates/index.js";
import {
  createDisabledMetricsService,
  createMetricsService,
} from "../../../modules/metrics/index.js";
import { composeSchedulesForOwner } from "../../../modules/schedules/index.js";
import {
  composeInvocationsQueryForOwner,
  isInvocationTargetName,
} from "../../../modules/invocations/index.js";
import { composeKnowledgeBasesForOwner } from "../../../modules/knowledge-bases/index.js";
import { composeArtifactLibraryForOwner } from "../../../modules/artifact-library/index.js";
import { composeExperimentsForOwner } from "../../../modules/experiments/index.js";
import { composeFeaturesForOwner } from "../../../modules/features/index.js";
import { composeSkillsModule } from "../../../modules/skills/compose.js";
import { composeFilesModule } from "../../../modules/files/files-service.js";
import { composeConnectionsForOwner } from "../../../modules/connections/compose.js";
import { composeApprovalsService } from "../../../modules/approvals/compose.js";
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
    redisBus,
    wrapperFrameSender,
    presetSeeder,
    trustedHosts,
    agentCleanupHooks,
    secretStores,
    runtimeMutator,
    contributionsProgress,
    getAgentCapabilities,
    schedulesBoot,
    listRegisteredAgentIds,
    metricsReader,
    terms,
    e2e,
    artifacts,
    k8sClient,
    agentsRepo,
    templatesRepo,
    reposService,
    connectionsBoot,
    apiKeysModule,
    liveEvents,
  } = boot;

  return (user: UserIdentity, surface: string): ApiContext => {
    const { templates, readSpec: readTemplateSpec } =
      composeTemplatesModule(templatesRepo);
    const connections = composeConnectionsForOwner({
      ownerId: user.sub,
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
    });
    const { agents, isOwnedAgent } = composeAgentsModule({
      api,
      namespace: config.namespace,
      agentIdleTimeoutMinutes: config.agentIdleTimeoutMinutes,
      agentDefaultLimits: {
        cpu: config.agentDefaultCpuLimit,
        memory: config.agentDefaultMemoryLimit,
      },
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
      readTemplateSpec,
      presetSeeder,
      cleanupHooks: agentCleanupHooks,
      runtimeMutator,
      contributionsProgress,
      grantProvisioner: {
        resolveSpecGrants(sel) {
          return Promise.resolve({
            grantedConnectionIds: Array.from(new Set(sel.connectionIds)),
          });
        },
        async applyAfterCreate(agentId, sel) {
          if (sel.connectionIds.length)
            await connections.setAgentConnections(agentId, sel.connectionIds);
        },
      },
    });
    const { schedules } = composeSchedulesForOwner({
      boot: schedulesBoot,
      owner: user.sub,
      agentBinding: user.agentIds,
      agentExists: async (agentId) => (await agents.get(agentId)) !== null,
    });
    const invocationsQuery = composeInvocationsQueryForOwner({
      db,
      owner: user.sub,
    });
    const { knowledgeBases } = composeKnowledgeBasesForOwner({
      owner: user.sub,
      surface,
      agents,
      runtimeMutator,
      wakeAgent: async (agentId) => {
        await agentsRepo.wakeIfHibernated(agentId);
      },
    });
    const { artifactLibrary, artifactRequests } =
      composeArtifactLibraryForOwner({
        surface,
        db,
        artifacts,
        owner: user.sub,
        shareBaseUrl: config.shareBaseUrl,
      });
    const { experiments } = composeExperimentsForOwner({
      db,
      owner: user.sub,
      surface,
      artifactLibrary,
      agents,
      pin: {
        set: (agentId) =>
          agentsRepo.patchAnnotation(agentId, EXPERIMENT_ACTIVE_KEY, "true"),
        clear: (agentId) =>
          agentsRepo.patchAnnotation(agentId, EXPERIMENT_ACTIVE_KEY, ""),
      },
      runtimeMutator,
      wakeAgent: async (agentId) => {
        await agentsRepo.wakeIfHibernated(agentId);
      },
    });
    const { features } = composeFeaturesForOwner({
      db,
      owner: user.sub,
      surface,
    });
    const skills = composeSkillsModule({
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
    const isAgentOwnedBy = async (agentId: string, ownerSub: string) =>
      (await agents.get(agentId)) !== null && ownerSub === user.sub;
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
      bus: redisBus,
      wrapperFrameSender,
    });
    const files = composeFilesModule(api, config.namespace, user.sub, surface);
    const apiKeys = apiKeysModule.createService({
      ownerSub: user.sub,
      surface,
    });
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
    const metrics = metricsReader
      ? createMetricsService({
          reader: metricsReader,
          listOwnedAgents: async () => {
            const [live, registered] = await Promise.all([
              agents.list(),
              listRegisteredAgentIds(user.sub),
            ]);
            const names = new Map(live.map((a) => [a.id, a.name]));
            const ids = [...new Set([...names.keys(), ...registered])];
            const scoped =
              user.agentIds === "*"
                ? ids
                : ids.filter((id) => user.agentIds.includes(id));
            return scoped.map((id) => ({ id, name: names.get(id) ?? null }));
          },
          isInvocationTargetName,
        })
      : createDisabledMetricsService();

    return {
      templates,
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
      egressRules,
      experiments,
      invocationsQuery,
      knowledgeBases,
      artifactLibrary,
      artifactRequests,
      features,
      files,
      harnessConfig,
      links: config.links,
      liveEvents,
      metrics,
      terms,
      usage: composeUsageForOwner(user.sub),
      e2e,
      apiKeys,
      budgets,
      user,
      e2eEnabled: config.e2eEnabled,
    };
  };
}
