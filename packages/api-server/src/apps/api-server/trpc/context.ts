import type { ApiContext, UserIdentity } from "api-server-api";
import { ChannelType, editorEmailOf, featureOnForUser } from "api-server-api";
import {
  childEgressGrants,
  childrenMirroringConnections,
  composeAgentsModule,
  composeEditorStanding,
  connectionGrantProvisioner,
  inheritanceOf,
} from "../../../modules/agents/index.js";
import { composeAssistantsForOwner } from "../../../modules/assistants/index.js";
import { assistantProvisioningGuard } from "../../../modules/assistants/services/provisioning-guard-instance.js";
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
  createRunBoundary,
  isNoDefaultModelError,
} from "../../../modules/harness-config/index.js";
import { agentsInstallSettings } from "../../../config.js";
import { composeBudgetsModule } from "../../../modules/budgets/index.js";
import { createChannelProfiles } from "../../../modules/channels/infrastructure/channel-profile.js";
import {
  findExternalLinksByIdentity,
  findExternalUsersByIdentity,
} from "../../../modules/channels/infrastructure/identity-links-repository.js";
import { createSlackDmBridgesRepository } from "../../../modules/channels/infrastructure/slack-dm-bridges-repository.js";
import {
  createSlackDmBridgeService,
  greetingOutcome,
  type SlackDmFailureCode,
} from "../../../modules/channels/services/slack-dm-bridge-service.js";
import type { SlackDmFailurePartial } from "../../../modules/channels/services/slack-dm-bridge-service.js";
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
import {
  composeProfileResolverOn,
  composeProfilesForOwner,
} from "../../../modules/profiles/index.js";
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
import { damKeyPortFor } from "../../../modules/connections/domain/dam-connection.js";
import { composeApprovalsService } from "../../../modules/approvals/compose.js";
import { composeAttentionService } from "../../../modules/attention/compose.js";
import { composeCostReviewsForOwner } from "../../../modules/cost-reviews/index.js";
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

/* UNIT_BOUNDARY_DESCRIPTION: How a Bridge refusal reaches a caller: a code the
 * CLI can branch on, never a silent success, and the part that persisted named
 * in the message so a partial connect is reported rather than hidden. A
 * Slack-side failure is a precondition — the workspace or the app said no. */
function slackDmError(
  code: SlackDmFailureCode,
  message: string,
  partial?: SlackDmFailurePartial,
): TRPCError {
  const trpcCode =
    code === "agent-not-found"
      ? "NOT_FOUND"
      : code === "linked-to-another-account" ||
          code === "linked-to-another-workspace"
        ? "CONFLICT"
        : "PRECONDITION_FAILED";
  const persisted = partial
    ? ` (${[
        partial.link === undefined ? null : `link ${partial.link}`,
        partial.binding === undefined ? null : `binding ${partial.binding}`,
        partial.helloPosted === undefined
          ? null
          : `hello ${partial.helloPosted ? "posted" : "not posted"}`,
      ]
        .filter(Boolean)
        .join(", ")} in ${partial.dmChannelId})`
    : "";
  return new TRPCError({
    code: trpcCode,
    message: `${message}${persisted}`,
    cause: partial,
  });
}

export function createApiContextFactory(boot: ApiServerDeps) {
  const {
    config,
    api,
    db,
    channelManager,
    identityLinkService,
    telegramBindFlows,
    slackBindFlows,
    seedSources,
    spendForOwner,
    spendCeilingsForOperator,
    spendHold,
    userBudgetsForOperator,
    loginTestimonials,
    providerStatus,
    outageAlerts,
    wrapperFrameSender,
    presetSeeder,
    childEgressSeeder,
    platformAccess,
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
    subPseudonymizer,
    metricsReader,
    telemetryReader,
    sessionDirectory,
    terms,
    isTermsAccepted,
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
  const slackDmBridges = createSlackDmBridgesRepository(db);

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
    const { features } = composeFeaturesForOwner({
      db,
      owner: user.sub,
      surface,
      modes: config.featureModes,
    });
    /* UNIT_BOUNDARY_DESCRIPTION: whether this person is offered the Connection that drives the install — the install's mode, and in `experimental` their own switch. It gates their own create and grants of it, never the platform's provisioning: Dambledore is made holding it whatever this says. */
    const damConnectionOffered = async (): Promise<boolean> => {
      const mode = config.featureModes.damConnection;
      if (mode === "on") return true;
      if (mode !== "experimental") return false;
      return featureOnForUser(mode, (await features.flags()).damConnection);
    };
    const connections = composeConnectionsForOwner({
      ownerId: user.sub,
      mirroredChildren: childrenMirroringConnections(db),
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
      providerModelCatalog: connectionsBoot.providerModelCatalog,
      damKey: damKeyPortFor(
        apiKeysModule.createService({
          ownerSub: user.sub,
          surface: "platform",
        }),
        {
          activeKeyIds: apiKeysModule.activeKeyIds,
          ledger: apiKeysModule.keyLedger(user.sub),
        },
        config.brand.name,
      ),
      damConnectionOffered,
      newAgentProvider: async () => {
        const chosen = await defaultProfile();
        return chosen
          ? { connectionId: chosen.connectionId, harness: chosen.harness }
          : null;
      },
    });
    /* UNIT_BOUNDARY_DESCRIPTION: The Slack DM Bridge, per owner: it pairs their
     * own Slack account and binds one of their Agents to their 1:1 DM with the
     * bot. Every Slack call goes through the channel manager, so whichever
     * replica serves the request, the leader's socket makes it, and everything
     * it settles is written through one repository whose record outlives what
     * it created. */
    const slackDm = createSlackDmBridgeService({
      trustedWorkspaces: config.slackEmailPairingWorkspaces,
      slackConfigured:
        channelManager.availableChannels()[ChannelType.Slack] === true,
      activeWorkspaces: async () =>
        (await listSlackInstalls(db)())
          .filter((install) => install.credentialState === "active")
          .map((install) => ({
            teamId: install.teamId,
            enterpriseId: install.enterpriseId,
          })),
      grantedScopes: (teamId) => channelManager.slackGrantedScopes(teamId),
      verifiedEmailOf: (sub) => userDirectory.resolveVerifiedEmailBySub(sub),
      linksOf: (sub) => findExternalLinksByIdentity(db)("slack", sub),
      lookupUserByEmail: (email, teamId) =>
        channelManager.slackEmailUserByEmail(email, teamId),
      openDirectMessage: async (slackUserId, teamId) => {
        const opened = await channelManager.slackOpenDirectMessage(
          slackUserId,
          teamId,
        );
        if (opened.kind !== "found" || !opened.channelId)
          throw new Error("Slack returned no conversation id");
        return opened.channelId;
      },
      conversationInfo: (channelId, teamId) =>
        channelManager.slackConversationInfo(channelId, teamId),
      agentOf: async (agentId, sub) => {
        const agent = await agentsRepo.get(agentId, sub);
        return agent ? { id: agent.id, name: agent.name } : null;
      },
      bridges: slackDmBridges,
      announceEmailLink: (slackUserId, sub) =>
        identityLinkService.announceLink("slack", slackUserId, sub),
      postHello: (agentId, slackChannelId, text) =>
        greetingOutcome(() =>
          channelManager.postMessage(agentId, ChannelType.Slack, text, {
            conversationId: slackChannelId,
          }),
        ),
      brandShort: config.brand.short,
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
      cpuPool: {
        defaultCpu: config.defaultUserCpuBudget,
        machineCpus: config.vmMachineCpus,
        agentStore: { authority: config.agentStore, db },
      },
      listAgentIds: async () =>
        (await agentsRepo.list(user.sub)).map((a) => a.id),
      isSlackUnlinked: async () =>
        channelManager.availableChannels()[ChannelType.Slack] === true &&
        (await findExternalUsersByIdentity(db)(ChannelType.Slack, user.sub))
          .length === 0,
    });
    const { profiles, resolveProfile, defaultProfile } =
      composeProfilesForOwner({
        db,
        subPseudonymizer,
        owner: user.sub,
        agentBinding: user.agentIds,
        catalog: harnesses,
        seed: config.curveBenderDeployment && config.defaultProfileSeed,
        ownerCatalog: () => connections.modelCatalog(),
        // UNIT_BOUNDARY_DESCRIPTION: the deployment owns that Connection only while its key is set, so only then does a create reconcile it.
        ...(config.curveBenderDeployment && {
          reconcileConnections: () => connections.reconcileManagedConnections(),
        }),
        republish: (agentId) => harnessConfig.republishDefaults(agentId),
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
      childEgress: childEgressSeeder,
      cleanupHooks: agentCleanupHooks,
      runtimeMutator,
      contributionsProgress,
      onboardingChecklists,
      grantProvisioner: connectionGrantProvisioner(connections, harnesses),
      defaultProfile,
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
      runtimeMutator,
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
    const provisioning = assistantProvisioningGuard();
    /* UNIT_BOUNDARY_DESCRIPTION: whether the assistant is on for this person — the install's mode, and in `experimental` their own switch — asked so that a mode set to `on` or `off` costs no read at all. */
    const assistantOn = async (): Promise<boolean> => {
      const mode = config.featureModes.dambledore;
      if (mode === "on") return true;
      if (mode !== "experimental") return false;
      return featureOnForUser(mode, (await features.flags()).dambledore);
    };
    const {
      assistants,
      ensure: ensureAssistant,
      optIn: assistantOptIn,
    } = composeAssistantsForOwner({
      db,
      owner: user.sub,
      assistantName: config.brand.assistantName,
      brandName: config.brand.name,
      enabled: assistantOn,
      admitted: () => isTermsAccepted(user.sub),
      agentOf: (agentId) => agentsRepo.getLive(agentId, user.sub),
      agents,
      gettingStarted,
      damConnection: () => connections.ensureDamConnection({ platform: true }),
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
    const chatSessionPair = (agentId: string) =>
      firePair(agentId, "chat", {}).catch((err: unknown) => {
        if (isNoDefaultModelError(err))
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `${err.message.charAt(0).toUpperCase()}${err.message.slice(1)}.`,
          });
        throw err;
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
      sessionPair: chatSessionPair,
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
      platformAccess,
      childEgress: {
        available: async (agentId) =>
          Boolean((await features.flags()).environments) &&
          !(await inheritanceOf(db)(agentId)) &&
          !(await agentsRepo.get(agentId, user.sub))?.spec.environmentOf,
        isGranted: (agentId) => childEgressGrants(db).isGranted(agentId),
        set: (agentId, on, decidedBy) =>
          childEgressGrants(db).set(agentId, on, decidedBy),
      },
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
      childEgressGrants: childEgressGrants(db),
    });
    const costReviews = composeCostReviewsForOwner({
      db,
      owner: user.sub,
      floors: {
        minWeeklyUsd: config.costReviewMinWeeklyUsd,
        minWeeklyBobcoins: config.costReviewMinWeeklyBobcoins,
      },
      ownedAgents: async () =>
        (await agentsRepo.list(user.sub)).flatMap((agent) =>
          agent.createdAt
            ? [{ id: agent.id, createdAt: new Date(agent.createdAt) }]
            : [],
        ),
      spendHold,
      sessionPair: chatSessionPair,
      runtimeMutator,
      wakeAgent,
    });
    const attention = composeAttentionService({
      db,
      ownerSub: user.sub,
      ownsApproval: async (approvalId) =>
        (await createApprovalsRepository(db).getPending(approvalId))
          ?.ownerSub === user.sub,
      ownsAgent: (agentId) => agentsRepo.isOwnedBy(agentId, user.sub),
      defaultModelNotices: async () =>
        createDefaultModelNoticeReader(
          db,
          resolveProfile,
        )((await agentsRepo.list(user.sub)).map((agent) => agent.id)),
      outageAlerts: () => outageAlerts.noticesFor(user.sub, new Date()),
      costReviews: () => costReviews.offers(),
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
    /* UNIT_BOUNDARY_DESCRIPTION: the defaults a runtime follows are settled for their run here, so the event carries the native subagent keys derived from each pair (D193B). */
    const runBoundary = createRunBoundary({
      inputsOf: async (agentId) => ({
        capabilities: await getAgentCapabilities(agentId),
        catalog: await connections.modelCatalog(agentId),
      }),
    });
    const { service: harnessConfig } = composeHarnessConfigModule({
      boundary: runBoundary,
      resolveProfileOn: composeProfileResolverOn(subPseudonymizer),
      catalog: harnesses,
      resolveProfile,
      db,
      outboxRepo,
      ownerSub: user.sub,
      surface,
      runtimeMutator,
      isOwnedAgent,
      getCapabilities: getAgentCapabilities,
      ownerCatalog: (agentId) => connections.modelCatalog(agentId),
      specHarness: async (agentId) =>
        (await agentsRepo.get(agentId))?.spec.harness,
      isSettled: (agentId) =>
        contributionsProgress.progress(agentId).then((p) => p.settled),
      hiddenHarnesses: async () =>
        new Set((await features.flags()).hermes ? [] : ["hermes"]),
    });
    const artifactLibrary = artifactLibraryFor(user.sub, surface, {
      agentExists,
      validateChoice: (agentId, pair, references) =>
        harnessConfig.validateChoice(agentId, pair, references),
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

    /* UNIT_BOUNDARY_DESCRIPTION: the assistant is on for everyone who has not turned it off, so a person's first request gives them one — once, and never again after they delete theirs. It runs behind the replica's guard and is never awaited: a create takes as long as it takes, the person's page is answered without it, and the UI picks the Agent up from the agents live hint. An install pinned off pays nothing at all, and one that offers it reads the person's record first, which is one indexed read for anyone who already has it. A request from an API key or from an Agent's own credentials is not a person arriving, so it gives nothing. */
    const provisionAssistant = (): void => {
      if (config.featureModes.dambledore === "off") return;
      if (
        user.keyId !== undefined ||
        user.agentIds !== "*" ||
        user.actingEditor !== undefined
      )
        return;
      provisioning.start(user.sub, () => ensureAssistant());
    };

    /* UNIT_BOUNDARY_DESCRIPTION: the switch itself is the ask, so this makes the assistant whenever the person has none under that name. */
    const optInToAssistant = async () => {
      if (
        user.keyId !== undefined ||
        user.agentIds !== "*" ||
        user.actingEditor !== undefined
      )
        return;
      await assistantOptIn();
    };

    const ctx: ApiContext = {
      templates: templatesRepo,
      harnesses,
      repos: reposService,
      agents,
      schedules,
      channels: {
        available: channelManager.availableChannels(),
        telegramBotUsername: () => channelManager.telegramBotUsername(),
        setChoice: async ({
          agentId,
          type,
          slackChannelId,
          conversationId,
          pair,
          ...references
        }) => {
          await harnessConfig.validateChoice(agentId, pair, references);
          await createChannelProfiles(db, resolveProfile).set({
            agentId,
            channel: { type, id: slackChannelId ?? conversationId ?? "" },
            pair,
            references,
          });
        },
        slackDm: {
          status: () => slackDm.status(user.sub),
          connect: async (input) => {
            const result = await slackDm.connect(user.sub, input);
            if (!result.ok)
              throw slackDmError(result.code, result.message, result.partial);
            return {
              teamId: result.teamId,
              slackUserId: result.slackUserId,
              dmChannelId: result.dmChannelId,
              link: result.link,
              binding: result.binding,
              isDefault: result.isDefault,
              helloPosted: result.helloPosted,
            };
          },
          disconnect: async (input) => {
            const result = await slackDm.disconnect(user.sub, input);
            if (!result.ok)
              throw slackDmError(result.code, result.message, result.partial);
            return {
              disconnected: result.disconnected,
              threadsReleased: result.threadsReleased,
              linksRemoved: result.linksRemoved,
              incomplete: result.incomplete,
            };
          },
        },
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
      costReviews,
      egressRules,
      invocationsQuery,
      environments: environmentsFor(user.sub),
      invocationsControl,
      starterKits,
      kbShares,
      artifactLibrary,
      caseStudies,
      profiles,
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
      loginTestimonials: loginTestimonials.forOperator(user.sub),
      providerStatus,
      user,
      assistants,
      provisionAssistant,
      optInAssistant: optInToAssistant,
      e2eEnabled: config.e2eEnabled,
      featureModes: config.featureModes,
      telemetryBackend: telemetryReader !== null,
      actOnAgent,
    };
    return ctx;
  };
  return contextFor;
}
