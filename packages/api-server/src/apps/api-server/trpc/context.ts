import type { ApiContext, UserIdentity } from "api-server-api";
import { ChannelType, editorEmailOf } from "api-server-api";
import {
  composeAgentsModule,
  composeEditorStanding,
  connectionGrantProvisioner,
} from "../../../modules/agents/index.js";
import { createEgressRulesRepository } from "../../../modules/egress-rules/infrastructure/egress-rules-repository.js";
import { createEnvironmentsRepository } from "../../../modules/environments/infrastructure/environments-repository.js";
import { createAgentTargetResolver } from "./agent-target.js";
import { createActOnAgent } from "./act-on-agent.js";
import { ANN_STARTER_KIT_ONBOARDED } from "../../../modules/agents/infrastructure/labels.js";
import { createKitUpdateMarks } from "../../../modules/agents/infrastructure/kit-update-marks.js";
import { TRPCError } from "@trpc/server";
import {
  composeHarnessConfigModule,
  createDefaultModelNoticeReader,
  isNoDefaultModelError,
} from "../../../modules/harness-config/index.js";
import { agentsInstallSettings } from "../../../config.js";
import { composeBudgetsModule } from "../../../modules/budgets/index.js";
import { findExternalUsersByIdentity } from "../../../modules/channels/infrastructure/identity-links-repository.js";
import { createSlackLoopGuardDropsRepository } from "../../../modules/channels/infrastructure/slack-loop-guard-drops-repository.js";
import { listSlackInstalls } from "../../../modules/channels/infrastructure/slack-installs-repository.js";
import { withWorkspaceNames } from "../../../modules/channels/domain/slack-channel-choices.js";
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
  composeInvocationsControlForOwner,
  isInvocationTargetName,
} from "../../../modules/invocations/index.js";
import { composeStarterKitsForOwner } from "../../../modules/starter-kits/index.js";
import { composeKbSharesForOwner } from "../../../modules/kb-shares/index.js";
import { composeCaseStudiesForOwner } from "../../../modules/case-studies/index.js";
import { composeFeaturesForOwner } from "../../../modules/features/index.js";
import {
  composeChatFormPreferencesForOwner,
  createChatFormPreferencesReader,
} from "../../../modules/chat-forms/index.js";
import { composeSkillsModule } from "../../../modules/skills/compose.js";
import { composeFilesModule } from "../../../modules/files/files-service.js";
import {
  composeConnectionsForOwner,
  composeSecretRequestsForOwner,
} from "../../../modules/connections/compose.js";
import { oauthCallbackUrl } from "../../../modules/connections/domain/oauth-callback-url.js";
import { composeApprovalsService } from "../../../modules/approvals/compose.js";
import { composeAttentionService } from "../../../modules/attention/compose.js";
import { createApprovalsRepository } from "../../../modules/approvals/infrastructure/approvals-repository.js";
import { composeUsageForOwner } from "../../../modules/usage/compose.js";
import {
  composeEgressRulesModule,
  createConnectionRulesSyncAdapter,
  createEgressRuleWriterAdapter,
  createKitRulesSeederAdapter,
} from "../../../modules/egress-rules/compose.js";
import { createL7HostsPortFor } from "../../../modules/agent-store/l7-hosts.js";
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
    spendForOwner,
    spendCeilingsForOperator,
    userBudgetsForOperator,
    providerStatus,
    outageAlerts,
    wrapperFrameSender,
    presetSeeder,
    trustedHosts,
    agentCleanupHooks,
    environmentsFor,
    secretStore,
    runtimeMutator,
    outboxRepo,
    contributionsProgress,
    onboardingChecklists,
    gettingStarted,
    sidebarOrder,
    getAgentCapabilities,
    schedulesBoot,
    listRegisteredAgentIds,
    metricsReader,
    telemetryReader,
    sessionDirectory,
    terms,
    e2e,
    artifacts,
    delegationFrames,
    k8sClient,
    agentsRepo,
    templatesRepo,
    harnessCatalog: harnesses,
    starterKitsRepo,
    kitUpstream,
    linkedKits,
    firePair,
    reposService,
    connectionsBoot,
    apiKeysModule,
    satellitesBoot,
    liveEvents,
    userDirectory,
    wakeAgent,
    artifactLibraryFor,
  } = boot;

  const defaultLimits = {
    cpu: config.agentDefaultCpuLimit,
    memory: config.agentDefaultMemoryLimit,
  };
  const readChatFormPreferences = createChatFormPreferencesReader(db);

  const editorStanding = composeEditorStanding({ db, repo: agentsRepo });
  const agentOfTarget = createAgentTargetResolver({
    schedules: schedulesBoot.repo,
    egressRules: createEgressRulesRepository(db),
    environments: createEnvironmentsRepository(db),
    approvals: createApprovalsRepository(db),
  });

  const contextFor = (user: UserIdentity, surface: string): ApiContext => {
    const actOnAgent = createActOnAgent({
      user,
      self: () => ctx,
      agentOfTarget,
      editorStanding,
      contextFor: (identity) => contextFor(identity, surface),
    });
    const connections = composeConnectionsForOwner({
      ownerId: user.sub,
      maxSharedKbConnections: config.kbShareMaxConnectionsPerOwner,
      db,
      templates: connectionsBoot.templates,
      oauthEngine: connectionsBoot.oauthEngine,
      githubAppEngine: connectionsBoot.githubAppEngine,
      s3CredentialProbe: connectionsBoot.s3CredentialProbe,
      providerKeyProbe: connectionsBoot.providerKeyProbe,
      secretStore,
      runtimeMutator,
      agentsRepo,
      connectionRulesSync: createConnectionRulesSyncAdapter(db),
      oauthCallbackUrl: oauthCallbackUrl(config.uiBaseUrl),
      brandName: config.brand.name,
      curveBenderDeploymentKey: config.curveBenderDeployment?.apiKey ?? null,
      harnesses,
    });
    const secretRequests = composeSecretRequestsForOwner({
      ownerId: user.sub,
      db,
      uiBaseUrl: config.uiBaseUrl,
      stores: connectionsBoot.secretRequestStores,
      templates: connectionsBoot.templates,
      connections,
      agentName: async (agentId) =>
        (await agentsRepo.get(agentId, user.sub))?.name ?? null,
    });
    const { budgets, storageGate } = composeBudgetsModule({
      k8s: k8sClient,
      owner: user.sub,
      listAgentIds: async () =>
        (await agentsRepo.list(user.sub)).map((a) => a.id),
      isSlackUnlinked: async () =>
        channelManager.availableChannels()[ChannelType.Slack] === true &&
        (await findExternalUsersByIdentity(db)(ChannelType.Slack, user.sub))
          .length === 0,
    });
    const { agents, isOwnedAgent } = composeAgentsModule({
      api,
      resolveSlackWorkspace: boot.resolveSlackWorkspace,
      slackChannelMembership: (keycloakSub, slackChannelId, teamId) =>
        channelManager.slackChannelMembership(
          keycloakSub,
          slackChannelId,
          teamId,
        ),
      agentStateCache: boot.agentStateCache,
      agentStore: { authority: config.agentStore },
      namespace: config.namespace,
      agentIdleTimeoutMinutes: config.agentIdleTimeoutMinutes,
      agentDefaultLimits: defaultLimits,
      install: agentsInstallSettings(config),
      storageGate,
      owner: user.sub,
      actor: user.actingEditor ?? user.sub,
      editorEmail: editorEmailOf(user),
      resolveUserEmail: (sub) => userDirectory.resolveBySub(sub),
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
      resolveSlackConversationLabels: (refs) =>
        channelManager.resolveSlackConversationLabels(refs),
      readSlackLoopGuardDrops: (slackChannelIds) =>
        createSlackLoopGuardDropsRepository(db).readMany(slackChannelIds),
      readTemplateSpec: templatesRepo.readSpec,
      presetSeeder,
      cleanupHooks: agentCleanupHooks,
      runtimeMutator,
      contributionsProgress,
      onboardingChecklists,
      grantProvisioner: connectionGrantProvisioner(connections, harnesses),
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
      frames: delegationFrames,
    });
    const invocationsControl = composeInvocationsControlForOwner({
      db,
      owner: user.sub,
      agents,
      frames: delegationFrames,
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
    const { features } = composeFeaturesForOwner({
      db,
      owner: user.sub,
      surface,
      modes: config.featureModes,
    });
    const skills = composeSkillsModule({
      agentStateCache: boot.agentStateCache,
      agentStore: { authority: config.agentStore },
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
    const l7Hosts = createL7HostsPortFor({
      authority: config.agentStore,
      k8s: k8sClient,
      db,
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
      sessionPair: (agentId) =>
        firePair(agentId, "chat", {}).catch((err: unknown) => {
          if (isNoDefaultModelError(err))
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: `${err.message.charAt(0).toUpperCase()}${err.message.slice(1)}.`,
            });
          throw err;
        }),
      egressRules: createKitRulesSeederAdapter(db, l7Hosts),
      kitUpstream,
      kitUpdateMarks: createKitUpdateMarks(agentsRepo),
      linkedKits,
      chatFormPreferences: (agentId) =>
        readChatFormPreferences(
          agentId,
          async () => (await features.flags())["chat-forms"],
        ),
    });
    const isAgentOwnedBy = async (agentId: string, ownerSub: string) =>
      (await agentExists(agentId)) && ownerSub === user.sub;
    const chatFormPreferences = composeChatFormPreferencesForOwner({
      db,
      ownerSub: user.sub,
      isAgentOwnedBy,
    });
    const { service: egressRules } = composeEgressRulesModule({
      db,
      ownerSub: user.sub,
      actor: user.actingEditor ?? user.sub,
      resolveUserEmail: (sub) => userDirectory.resolveBySub(sub),
      isAgentOwnedBy,
      l7Hosts,
      presetSeeder,
      trustedHosts,
    });
    const { service: approvals } = composeApprovalsService({
      db,
      ownerSub: user.sub,
      actor: user.actingEditor ?? user.sub,
      actorEmail:
        (user.actingEditor !== undefined
          ? user.actingEditorEmail
          : user.email) ?? null,
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
      ownsAgent: (agentId) => agentsRepo.isOwnedBy(agentId, user.sub),
      defaultModelNotices: async () =>
        createDefaultModelNoticeReader(db)(
          (await agentsRepo.list(user.sub)).map((agent) => agent.id),
        ),
      outageAlerts: () => outageAlerts.noticesFor(user.sub, new Date()),
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
      catalog: harnesses,
      db,
      outboxRepo,
      ownerSub: user.sub,
      surface,
      runtimeMutator,
      isOwnedAgent,
      getCapabilities: getAgentCapabilities,
      specHarness: async (agentId) =>
        (await agentsRepo.get(agentId))?.spec.harness,
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
          connectionNames: async () =>
            new Map(
              (await connections.listConnections()).map((c) => [c.id, c.name]),
            ),
          sessionTypeSpend: createSessionTypeSpend({
            readSpend: (agentIds, window) =>
              metricsReader.spendBySession(agentIds, window),
            categorizeSessions: (agentIds, sessionIds) =>
              sessionDirectory.categorize(agentIds, sessionIds),
          }),
        })
      : createDisabledMetricsService();
    const telemetry = telemetryReader
      ? createTelemetryService({ reader: telemetryReader, listOwnedAgents })
      : createDisabledTelemetryService();

    const ctx: ApiContext = {
      templates: templatesRepo,
      harnesses,
      repos: reposService,
      agents,
      schedules,
      channels: {
        available: channelManager.availableChannels(),
        telegramBotUsername: () => channelManager.telegramBotUsername(),
        slackChannelChoices: async () => {
          const [choices, installs] = await Promise.all([
            channelManager.slackChannelChoices(user.actingEditor ?? user.sub),
            listSlackInstalls(db)(),
          ]);
          return withWorkspaceNames(
            choices,
            new Map(installs.map((i) => [i.teamId, i.teamName])),
          );
        },
      },
      connections,
      secretRequests,
      skills,
      approvals,
      attention,
      egressRules,
      invocationsQuery,
      environments: environmentsFor(user.sub),
      invocationsControl,
      starterKits,
      kbShares,
      artifactLibrary,
      caseStudies,
      features,
      chatFormPreferences,
      gettingStarted: gettingStarted.forOwner(user.sub),
      sidebarOrder: sidebarOrder.forOwner(user.sub),
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
      spend: spendForOwner({
        ownerSub: user.sub,
        agentBinding: user.agentIds,
        isAgentOwnedBy: (agentId, ownerSub) =>
          agentsRepo.isOwnedBy(agentId, ownerSub),
      }),
      spendCeilings: spendCeilingsForOperator(user.sub),
      userBudgets: userBudgetsForOperator(user.sub),
      providerStatus,
      user,
      e2eEnabled: config.e2eEnabled,
      featureModes: config.featureModes,
      telemetryBackend: telemetryReader !== null,
      actOnAgent,
    };
    return ctx;
  };
  return contextFor;
}
