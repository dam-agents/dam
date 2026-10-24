import { readFileSync } from "node:fs";
import { createDb, runMigrations } from "db";
import {
  type TriggerEventPayload,
  workspaceMutationEventKinds,
} from "agent-runtime-api";
import {
  createAgentInformer,
  createApi,
  createK8sClient,
  createLeaseApi,
  agentServiceAddress,
  type KubeObject,
} from "./modules/agents/infrastructure/k8s.js";
import {
  createAgentChangeFeed,
  postgresChangeSource,
} from "./modules/agent-store/feed.js";
import { createControlAgentStateCache } from "./modules/agent-store/cache.js";
import { createControlAgentsRepository } from "./modules/agent-store/agents-repository.js";
import {
  agentStoreMarkerName,
  agentStoreRefusal,
  readAgentStoreMarker,
} from "./modules/agent-store/fence.js";
import { reportAbsorbPreview } from "./modules/agent-store/preview.js";
import {
  composeStorageGate,
  composeUserBudgetsAdmin,
  listRunnerUsageOwners,
  readRunnerUsage,
} from "./modules/budgets/index.js";
import { composeResourceAlerts } from "./modules/resource-alerts/index.js";
import { parseInfraAgent } from "./modules/agents/infrastructure/agent-mappers.js";
import { createKitUpdateMarks } from "./modules/agents/infrastructure/kit-update-marks.js";
import {
  AGENTS_PLURAL,
  ANN_STARTER_KIT,
  ANN_STARTER_KIT_ONBOARDED,
  INVOCATIONS_ACTIVE_KEY,
  LAST_ACTIVITY_KEY,
  LABEL_OWNER,
} from "./modules/agents/infrastructure/labels.js";
import {
  composeAgentsModule,
  composePublicAgentPage,
  attachProviderToBareAgents,
  connectionGrantProvisioner,
  createAgentsRepository,
  createAgentEnvRepository,
  createAgentRegistrySecretPort,
  createKeycloakUserDirectory,
  allChannelAgentIds,
  findChannelOwnerByAgent,
  deleteChannelsByAgent,
  listChannelsByOwner,
  findSlackBindingsByChannelId,
  claimUnscopedSlackBindings,
  findSlackChannelsByAgent,
  deleteSlackChannelBinding,
  setSlackChannelAmbient,
  setSlackChannelDefault,
  createAgentSweep,
  createImageUpdate,
  agentServiceIsIdle,
  createAvatarImagesRepository,
  MAX_AVATAR_BYTES,
  storeAvatarImage,
  sweepAvatarImages,
} from "./modules/agents/index.js";
import {
  composePrStateResolver,
  connectScanCacheBus,
  createAgentSkillsRepository,
  parseSeedSources,
  scanPublicGithubArchive,
} from "./modules/skills/index.js";
import {
  composeKbShareServing,
  createKbShareAgentCleanup,
  createShareHostApp,
  findKbShareOwnerByAgent,
  listKbShareAgentIds,
  startKbShareSync,
} from "./modules/kb-shares/index.js";
import { createAcpClient, type AcpClientFactory } from "./core/acp-client.js";
import { retryWhileUnreachable } from "./core/retry-unreachable.js";
import { createPostgresState } from "@chat-adapter/state-pg";
import {
  createSlackWorker,
  type SlackOAuthPending,
  type ChannelRegistry,
} from "./modules/channels/infrastructure/slack.js";
import { createImgbbAgentIcons } from "./modules/channels/infrastructure/agent-avatar-icons.js";
import { createAgentWorkspaceFiles } from "./modules/channels/infrastructure/agent-workspace-files.js";
import { DEFAULT_SETTLE_MS } from "./modules/channels/domain/turn-coalescing.js";
import { createBoltSlackGateway } from "./modules/channels/infrastructure/bolt-slack-gateway.js";
import { createPublicImageUrlsRepository } from "./modules/channels/infrastructure/public-image-urls-repository.js";
import { createSlackIgnoredAppsRepository } from "./modules/channels/infrastructure/slack-ignored-apps-repository.js";
import { createSlackLoopGuardDropsRepository } from "./modules/channels/infrastructure/slack-loop-guard-drops-repository.js";
import {
  createFakeSlackGateway,
  FAKE_WORKSPACE,
} from "./modules/channels/infrastructure/fake-slack-gateway.js";
import { createFakeSlackTokenRotation } from "./modules/channels/infrastructure/fake-slack-token-rotation.js";
import { createTelegramWorker } from "./modules/channels/infrastructure/telegram.js";
import {
  createChannelManager,
  channelRpcRequestSchema,
  type ChannelRpcRequest,
} from "./modules/channels/services/channel-manager.js";
import { createIdentityLinkService } from "./modules/channels/services/identity-link-service.js";
import {
  findIdentityByExternalUser,
  findExternalUsersByIdentity,
  upsertIdentityLink,
  findExternalLinksByIdentity,
  deleteIdentityLink,
} from "./modules/channels/infrastructure/identity-links-repository.js";
import {
  findAgentByConversation,
  bindConversation,
  listConversationsByAgent,
  listConversationsAuthorizedBy,
  unbindConversation,
  setConversationAmbient,
  allConversationAgentIds,
  deleteConversationsByAgent,
} from "./modules/channels/infrastructure/telegram-conversations-repository.js";
import type {
  TelegramOAuthPending,
  TelegramPendingBind,
} from "./modules/channels/infrastructure/telegram-flows.js";
import type { SlackPendingBind } from "./modules/channels/infrastructure/slack-flows.js";
import { createFlowStore } from "./modules/channels/infrastructure/bind-flow-store.js";
import type { SlackInstallPending } from "./modules/channels/infrastructure/slack-install-routes.js";
import {
  findSlackInstall,
  listSlackInstalls,
  setSlackCredentialState,
  upsertSlackInstall,
} from "./modules/channels/infrastructure/slack-installs-repository.js";
import { createSlackWorkspaceProbe } from "./modules/channels/services/slack-workspace-probe.js";
import { createSlackInstallService } from "./modules/channels/services/slack-install-service.js";
import {
  createSlackTokenRotation,
  noSlackTokenRotation,
  type SlackTokenRotation,
} from "./modules/channels/infrastructure/slack-token-rotation.js";
import {
  composeRuntimeDelivery,
  createBullConnection,
  sessionPairFields,
} from "./modules/runtime-delivery/index.js";
import {
  createHarnessConfigSnapshotWriter,
  harnessConfigSupportOf,
  composeConvertingFirePair,
  composeDefaultConverter,
  composeFirePair,
  composeScheduleModelForFire,
  composeHarnessConfigReset,
  composeSessionChoicesValidator,
  createInitializationPairResolver,
  createUnattendedAgentsReader,
  isNoDefaultModelError,
} from "./modules/harness-config/index.js";
import {
  composeSchedulesAtBoot,
  createSchedulesCleanupHook,
} from "./modules/schedules/index.js";
import { createKubernetesSecretStore } from "./modules/secret-store/index.js";
import {
  composeAttentionRetention,
  composeSessionWatcher,
  createAttentionCleanupHook,
  listAttentionAgentIds,
} from "./modules/attention/index.js";
import { composeSessionDirectory } from "./modules/session-directory/index.js";
import { composeUsageModule } from "./modules/usage/compose.js";
import { composeGettingStartedModule } from "./modules/getting-started/index.js";
import { composeSidebarOrderModule } from "./modules/sidebar-order/index.js";
import {
  createUsageAgentsCleanupHook,
  listUsageAgentIds,
} from "./modules/usage/index.js";
import { listAgentIdsByOwner } from "./modules/usage/infrastructure/agents-postgres-repository.js";
import {
  composeTelemetryReader,
  createTelemetryRoutes,
} from "./modules/telemetry/index.js";
import { carriesInspectorRole } from "./modules/usage/infrastructure/actor-role-flags.js";
import {
  composeMetricsReader,
  createAgentTelemetry,
} from "./modules/metrics/index.js";
import { composeCaseStudiesModule } from "./modules/case-studies/index.js";
import { composeAuditModule } from "./modules/audit/index.js";
import { composeLiveEventsModule } from "./modules/live-events/index.js";
import { composeE2eModule } from "./modules/e2e/compose.js";
import { composeTermsModule } from "./modules/terms/index.js";
import { agentsInstallSettings, loadConfig } from "./config.js";
import { configureLogger, getLogger } from "./core/logger.js";
import { reconcileUsageViewGrants } from "./modules/usage/infrastructure/usage-view-grants.js";
import { reconcileControlGrants } from "./modules/agent-store/infrastructure/control-grants.js";
import { reportControlGrants } from "./modules/agent-store/infrastructure/control-grants-report.js";
import { reportUsageViewGrants } from "./modules/usage/infrastructure/usage-view-grants-report.js";
import { metrics } from "@opentelemetry/api";
import {
  composeUsageMetricsModule,
  createStateCountsRepository,
} from "./modules/usage-metrics/index.js";
import { formatError } from "./core/format-error.js";
import type { ApiServerDeps } from "./apps/api-server/deps.js";
import {
  createAuth,
  type SurfaceAttribution,
} from "./apps/api-server/admission/auth.js";
import { startJwksWarmup } from "./apps/api-server/admission/jwks-warmup.js";
import { createSessionPresence } from "./apps/api-server/agent-proxies/session-presence.js";
import {
  composeApiKeysModule,
  createApiKeysCleanupHook,
  isApiKeyToken,
  listApiKeyAgentIds,
} from "./modules/api-keys/index.js";
import {
  composeArtifactExpirySweeper,
  composeArtifactLibraryForOwner,
  composeShareAuth,
  composeShareRelayTokens,
  composeShareRenderTokens,
  composeShareBridge,
  composeShareViewer,
  createAgentApiClient,
  createByLinkHostGate,
  createContentApp,
  createShareAuthRoutes,
  loginPath,
  readShareSignIn,
  createShareViewerApp,
  shareSessionCookie,
  type ArtifactLibraryFor,
} from "./modules/artifact-library/index.js";
import { createReposRepository } from "./modules/repos/infrastructure/repos-repository.js";
import { composeArtifactsModule } from "./modules/artifacts/compose.js";
import { createTemplatesRepository } from "./modules/templates/infrastructure/templates-repository.js";
import {
  createHarnessCatalog,
  DEFAULT_TEMPLATE_ID,
} from "./modules/templates/domain/harness-catalog.js";
import {
  catalogEntryHosts,
  createCatalogSourceFromLocator,
  createOnboardingChecklist,
  createOnboardingChecklistRepository,
  createOnboardingMarker,
  createCatalogRefresh,
  createGitCatalogSource,
  createGitHosts,
  createGitRefResolver,
  createKitUpstream,
  createKitUpdateReporter,
  createLinkedKits,
  createResolvedCatalogRepository,
  parseCatalogSeeds,
  parseKitRef,
} from "./modules/starter-kits/index.js";
import {
  composeInvocationLivenessSweep,
  composeSubAgentOutcomeDelivery,
  createDriverResolutionAdapter,
  createSpawnSessionsAdapter,
  createInvocationTasksAdapter,
  createInvocationsCleanupHook,
  createDelegationFramesClient,
  createInvocationSetupFailure,
  composeScriptOutputs,
  runtimeRunsScripts,
  HARNESS_CONFIG_STEP,
  composeInvocationPinReconciler,
  listInvocationAgentIds,
} from "./modules/invocations/index.js";
import {
  composeEnvironmentGate,
  composeEnvironments,
  createEgressIdentityResolver,
  environmentNameLookup,
} from "./modules/environments/index.js";
import {
  composeApprovalsSystem,
  composeEgressProposals,
  composeSpendLimitQuestions,
  composeToolApprovalReports,
  createApprovalsCleanupHook,
  createSpendQuestionStore,
  listPendingApprovalAgentIds,
} from "./modules/approvals/compose.js";
import { createWrapperFrameSender } from "./modules/approvals/infrastructure/wrapper-frame-sender.js";
import { createChatFormPreferencesCleanup } from "./modules/chat-forms/index.js";
import {
  composeSpendSystem,
  createSpendLimitsCleanupHook,
  listSpendLimitAgentIds,
} from "./modules/spend/index.js";
import { composeProviderStatus } from "./modules/provider-status/index.js";
import { composeOutageAlerts } from "./modules/outage-alerts/index.js";
import {
  createEgressRuleMatchAdapter,
  createEgressRulesCleanupHook,
  createL7PromotionReconcile,
  createPresetSeederAdapter,
  listEgressRuleAgentIds,
  markTrustedRowsTakenOverAdapter,
} from "./modules/egress-rules/compose.js";
import {
  composeConnectionsAtBoot,
  composeAgentSecretRequests,
  composeConnectionsForOwner,
  createConnectionGrantsCleanupHook,
  createConnectionNames,
  createGrantedConnectionTemplates,
  createProviderEgressScopes,
  listConnectionGrantAgentIds,
  listConnectionTemplateIds,
  listManagedConnectionOwners,
} from "./modules/connections/compose.js";
import { oauthCallbackUrl } from "./modules/connections/domain/oauth-callback-url.js";
import { SECRET_REQUEST_TTL_MS } from "./modules/connections/services/secret-requests.js";
import { startAttachFirstProviderSaga } from "./modules/connections/sagas/attach-first-provider.js";
import { sweepManagedConnections } from "./modules/connections/sagas/managed-connections.js";
import { composeFeaturesForOwner } from "./modules/features/index.js";
import { createConnectionRulesSyncAdapter } from "./modules/egress-rules/compose.js";
import {
  createAgentArtifactsSweeper,
  type AgentCleanupSource,
} from "./sagas/agent-artifacts-sweeper.js";
import { createPeriodicJobs } from "./core/periodic-jobs.js";
import { createRedisTtlStore } from "./core/ttl-store.js";
import {
  createAddressSets,
  keycloakRealmUrl,
  type AddressSet,
} from "./core/address-sets.js";
import { createXactLock } from "./core/xact-lock.js";
import { createRedisBus } from "./core/redis-bus.js";
import { createBusRpc } from "./core/bus-rpc.js";
import { createRedisBlobHandoff } from "./core/blob-handoff.js";
import { createLeaderLease, type LeaderRole } from "./core/leader-lease.js";
import {
  startAgentStateCache,
  createLiveAgentStateCache,
} from "./modules/agents/infrastructure/agent-state-cache.js";
import { createOutOfMemoryWatch } from "./modules/agents/infrastructure/out-of-memory-watch.js";
import { createReadyWatch } from "./modules/agents/infrastructure/ready-watch.js";
import { agentRemovalWatch } from "./modules/agents/infrastructure/agent-removal-watch.js";
import { createTurnAttendance } from "./core/turn-attendance.js";
import { createSubPseudonymizer } from "./core/sub-pseudonymizer.js";
import {
  composeSatellitesModule,
  createOutcomeDelivery,
  createOutcomeWakeRetry,
} from "./modules/satellites/index.js";
import { createApprovalsRepository } from "./modules/approvals/infrastructure/approvals-repository.js";

export async function bootstrap() {
  const config = loadConfig();
  configureLogger({
    level: config.logLevel,
    base: { appVersion: config.appVersion },
  });
  getLogger().info("api-server starting");

  const { api } = createApi(config.namespace);
  const agentStoreMarker = await readAgentStoreMarker(
    api,
    config.namespace,
    config.agentStoreMarker ?? agentStoreMarkerName(config.releaseName),
  );
  const refusal = agentStoreRefusal(config.agentStore, agentStoreMarker);
  if (refusal) {
    getLogger().error(
      { agentStore: config.agentStore, release: config.releaseName },
      refusal,
    );
    throw new Error(refusal);
  }
  const dbTls = {
    ca: config.databaseCaCertPath
      ? readFileSync(config.databaseCaCertPath, "utf8")
      : undefined,
  };
  const bootRetry = {
    budgetMs: 120_000,
    delayMs: 2_000,
    log: (msg: string) => getLogger().warn(msg),
  };
  await retryWhileUnreachable(
    "migrations",
    () => runMigrations(config.databaseUrl, config.migrationsPath, dbTls),
    bootRetry,
  );
  const { db, sql } = createDb(config.databaseUrl, {
    tls: dbTls,
    poolMax: config.databasePoolMax,
  });
  reportUsageViewGrants(getLogger(), await reconcileUsageViewGrants(db));
  reportControlGrants(getLogger(), await reconcileControlGrants(db));
  if (config.agentStorePreviewReport && config.agentStore === "crd")
    await reportAbsorbPreview({
      listCustomObjects: (plural) =>
        createK8sClient(api, config.namespace).listCustomObjects(plural),
      db,
      logger: getLogger(),
      defaults: {
        cpuLimit: process.env.AGENT_LEGACY_CPU_LIMIT ?? "1",
        memoryLimit: process.env.AGENT_LEGACY_MEMORY_LIMIT ?? "2Gi",
      },
    });

  const artifactsModule = composeArtifactsModule({
    maxBytes: config.maxArtifactBytes,
    objectStorage: config.objectStorageEndpoint
      ? {
          endpoint: config.objectStorageEndpoint,
          agentEndpoint:
            config.objectStorageAgentEndpoint ?? config.objectStorageEndpoint,
          publicEndpoint: config.objectStoragePublicEndpoint ?? null,
          region: config.objectStorageRegion,
          bucket: config.objectStorageBucket,
          forcePathStyle: config.objectStorageForcePathStyle,
          credentials:
            config.objectStorageAccessKeyId != null &&
            config.objectStorageSecretAccessKey != null
              ? {
                  accessKeyId: config.objectStorageAccessKeyId,
                  secretAccessKey: config.objectStorageSecretAccessKey,
                }
              : null,
        }
      : null,
  });
  await retryWhileUnreachable(
    "object storage",
    () => artifactsModule.ensureReady(),
    bootRetry,
  );
  const artifacts = artifactsModule.service;

  if (!config.redisUrl)
    throw new Error("REDIS_URL is required (Redis is a platform primitive)");
  const redisPassword = config.redisPassword ?? undefined;
  const bullConnection = createBullConnection(config.redisUrl, redisPassword);
  const redisBus = createRedisBus(config.redisUrl, { password: redisPassword });
  const sharedRedis = createBullConnection(
    config.redisUrl,
    redisPassword,
  ) as import("ioredis").Redis;

  const turnAttendance = createTurnAttendance(sharedRedis);
  connectScanCacheBus(redisBus);

  const periodicJobs = createPeriodicJobs({
    connection: bullConnection,
    log: (msg) => process.stderr.write(`[periodic-jobs] ${msg}\n`),
  });

  const k8sClient = createK8sClient(api, config.namespace);
  const leaseApi = createLeaseApi();
  const outOfMemoryWatch = createOutOfMemoryWatch();
  let deliverOnReady: (agentId: string) => Promise<void> = async () => {};
  const readyWatch = createReadyWatch((agentId) => {
    deliverOnReady(agentId).catch((err: unknown) =>
      getLogger().warn(
        { err },
        `[runtime] ${agentId}: re-delivery on Ready failed; the outbox sweep will carry it`,
      ),
    );
  });
  const observe = ((kind: "add" | "update" | "delete", obj: KubeObject) => {
    outOfMemoryWatch(kind, obj);
    readyWatch(kind, obj);
    agentRemovalWatch(kind, obj);
  }) as (kind: "add" | "update" | "delete", obj: KubeObject) => void;
  const agentStateCache =
    config.agentStore === "postgres"
      ? (() => {
          let refresh: () => Promise<void> = async () => {};
          const feed = createAgentChangeFeed({
            source: postgresChangeSource(sql),
            snapshot: () => refresh(),
            log: (message, fields) =>
              getLogger().warn(fields ?? {}, `[agents] ${message}`),
          });
          const cache = createControlAgentStateCache({
            db,
            feed,
            log: (message, fields) =>
              getLogger().warn(fields ?? {}, `[agents] ${message}`),
          });
          refresh = cache.snapshot;
          return cache;
        })()
      : startAgentStateCache({
          informer: createAgentInformer(config.namespace),
          live: k8sClient,
          namespace: config.namespace,
          log: (m) => getLogger().warn(`[agents] ${m}`),
          observe,
        });
  const agentsRepo =
    config.agentStore === "postgres"
      ? createControlAgentsRepository(db, agentStateCache)
      : createAgentsRepository(k8sClient, agentStateCache);
  const delegationFrames = createDelegationFramesClient({
    namespace: config.namespace,
    isReady: (agentId) => agentsRepo.isReady(agentId),
  });
  const liveAgentsRepo =
    config.agentStore === "postgres"
      ? agentsRepo
      : createAgentsRepository(k8sClient, createLiveAgentStateCache(k8sClient));
  const agentEnvRepo = createAgentEnvRepository(db);

  const templatesRepo = createTemplatesRepository(config.agentTemplatesPath);
  const harnessCatalog = createHarnessCatalog(
    config.harnesses,
    (await templatesRepo.get(DEFAULT_TEMPLATE_ID)) !== null,
  );
  const resolvedCatalog = createResolvedCatalogRepository(db);
  const kitGitHosts = createGitHosts({
    host: config.githubEnterpriseHost,
    token: config.githubEnterpriseToken,
  });
  const kitRefs = createGitRefResolver(kitGitHosts);
  const kitUpstream = createKitUpstream({ hosts: kitGitHosts, refs: kitRefs });
  const scanKitSkills = async (gitUrl: string, ref: string, subPath: string) =>
    (await scanPublicGithubArchive(gitUrl, subPath, ref)).map((skill) => ({
      name: skill.name,
      description: skill.description,
    }));
  const kitSourceForEntry = (gitUrl: string, ref: string) =>
    createGitCatalogSource(kitGitHosts, gitUrl, ref);
  const linkedKits = createLinkedKits({
    refs: kitRefs,
    appVersion: config.appVersion,
    scanSkills: scanKitSkills,
    sourceForEntry: kitSourceForEntry,
  });
  const starterKitsRefresh = createCatalogRefresh({
    catalogs: parseCatalogSeeds(
      config.starterKitsCatalogs,
      kitGitHosts,
    ).flatMap((c) => {
      const located = createCatalogSourceFromLocator(
        kitGitHosts,
        c.locator,
        c.kind,
        c.ref,
        c.dir,
      );
      if (!located) return [];
      return [
        {
          name: c.name,
          ...located,
          entryHosts: catalogEntryHosts(kitGitHosts, located.gitUrl),
        },
      ];
    }),
    repo: resolvedCatalog,
    refs: kitRefs,
    sourceForEntry: kitSourceForEntry,
    appVersion: config.appVersion,
    scanSkills: scanKitSkills,
    avatar: {
      maxBytes: MAX_AVATAR_BYTES,
      store: (bytes, ownerSub) =>
        storeAvatarImage(createAvatarImagesRepository(db), bytes, ownerSub),
    },
  });
  const reposService = createReposRepository(config.gitReposPath);
  const userDirectory = createKeycloakUserDirectory({
    keycloakUrl: config.keycloakUrl,
    keycloakRealm: config.keycloakRealm,
    clientId: config.keycloakApiClientId,
    clientSecret: config.keycloakApiClientSecret,
  });
  const apiKeysModule = composeApiKeysModule({
    db,
    hmacKey: config.apiKeyHmacKey,
    isAgentOwnedBy: (agentId, ownerSub) =>
      agentsRepo.isOwnedBy(agentId, ownerSub),
    ownerDirectory: userDirectory,
  });
  const addresses = createAddressSets(
    {
      uiBaseUrl: config.uiBaseUrl,
      keycloakExternalUrl: config.keycloakExternalUrl,
      shareBaseUrl: config.shareBaseUrl,
      contentBaseUrl: config.contentBaseUrl,
    },
    config.backchannel,
  );
  const auth = createAuth(
    {
      issuers: addresses.all.map((set) =>
        keycloakRealmUrl(set, config.keycloakRealm),
      ),
      jwksUrl: `${config.keycloakUrl}/realms/${config.keycloakRealm}/protocol/openid-connect/certs`,
      audience: config.keycloakApiAudience,
      requiredRole: config.keycloakRequiredRole,
      operatorRole: config.keycloakOperatorRole,
    },
    {
      verifyApiKey: apiKeysModule.validator,
      verifyOwnerActive: apiKeysModule.verifyOwnerActive,
    },
  );
  const jwksWarmup = startJwksWarmup(auth.warmJwks);
  const surfaceAttribution: SurfaceAttribution = {
    uiClientId: config.keycloakClientId,
    cliClientId: config.keycloakCliClientId,
    coreRole: config.keycloakInspectorRole,
  };
  const shareViewer = composeShareViewer({ db, artifacts });
  const shareRenderTokens = composeShareRenderTokens({ redis: sharedRedis });
  const shareRelayTokens = composeShareRelayTokens({ redis: sharedRedis });
  const shareSignInFor = (set: AddressSet, storePrefix: string) => ({
    set,
    auth: composeShareAuth({
      redis: sharedRedis,
      keycloak: {
        externalUrl: set.keycloakExternalUrl,
        internalUrl: config.keycloakUrl,
        realm: config.keycloakRealm,
        clientId: config.keycloakShareClientId,
      },
      shareBaseUrl: set.shareBaseUrl,
      storePrefix,
    }),
    cookie: shareSessionCookie(set.shareBaseUrl),
  });
  const publicShareSignIn = shareSignInFor(addresses.public, "share");
  const shareSignIns = [
    publicShareSignIn,
    ...(config.backchannel
      ? [shareSignInFor(config.backchannel, "share-backchannel")]
      : []),
  ];
  const { auth: shareAuth, cookie: shareCookie } = publicShareSignIn;
  const { gate: environmentGate, frontDoor: environmentFrontDoor } =
    composeEnvironmentGate({
      db,
      redis: sharedRedis,
      urlTemplate: config.environmentsUrl,
      shareBaseUrl: config.shareBaseUrl,
      share: {
        visitor: async (c) => {
          const signIn = await readShareSignIn(c, shareAuth, shareCookie);
          return signIn
            ? {
                sub: signIn.session.sub,
                email: signIn.session.emailVerified
                  ? signIn.session.email
                  : null,
                shareSession: signIn.id,
              }
            : null;
        },
        alive: async (id) => (await shareAuth.getSession(id)) !== null,
        end: (id) => shareAuth.endSession(id),
        loginPath: (next) => loginPath(next),
        logoutPath: "/auth/logout",
        logoutUrl: (next) => shareAuth.logoutUrl(next),
      },
      platform: {
        issuers: [
          ...addresses.all.map((set) =>
            keycloakRealmUrl(set, config.keycloakRealm),
          ),
          `${config.keycloakUrl}/realms/${config.keycloakRealm}`,
        ],
        isApiKey: isApiKeyToken,
      },
      ensureReady: (agentId) => agentsRepo.ensureReady(agentId),
      stampActivity: (agentId) =>
        agentsRepo.patchAnnotation(
          agentId,
          LAST_ACTIVITY_KEY,
          new Date().toISOString(),
        ),
      namespace: config.namespace,
      brandName: config.brand.name,
    });
  await periodicJobs.register("avatar-images-sweep", 3_600_000, async () => {
    const agents = await agentsRepo.list();
    const kits = await resolvedCatalog.list();
    const removed = await sweepAvatarImages(createAvatarImagesRepository(db), [
      ...agents.map((a) => a.spec.avatar),
      ...kits.map((k) => k.kit.avatar),
    ]);
    if (removed > 0) getLogger().info({ removed }, "avatar_images.swept");
  });
  const sessionPresence = createSessionPresence(liveAgentsRepo, sharedRedis);
  await periodicJobs.register("session-presence-reconcile", 60_000, () =>
    sessionPresence.reconcile(),
  );

  const l7PromotionReconcile = createL7PromotionReconcile(db, k8sClient, (m) =>
    getLogger().info(`[l7-reconcile] ${m}`),
  );
  await periodicJobs.register(
    "l7-promotion-reconcile",
    5 * 60_000,
    async () => {
      const { drifted, failed } = await l7PromotionReconcile();
      if (drifted > 0 || failed > 0)
        getLogger().warn(
          `[l7-reconcile] re-projected ${drifted} drifted agent(s), ${failed} failed`,
        );
    },
  );

  const resolveAgentOwner = async (agentId: string) =>
    (await agentsRepo.get(agentId).catch(() => null))?.owner ?? null;
  const resolveAgentName = async (agentId: string) =>
    (await agentsRepo.getLive(agentId, undefined))?.name ?? null;

  const runtimeDelivery = composeRuntimeDelivery({
    db,
    namespace: config.namespace,
    bullConnection,
    agentRunningPort: {
      isRunning: (agentId) => agentsRepo.isReady(agentId),
    },
    snapshotWriter: createHarnessConfigSnapshotWriter({
      db,
      resolveOwner: resolveAgentOwner,
    }),
    harnessServerUrl: config.harnessServerUrl,
    telemetryEnv: harnessCatalog.telemetryEnv,
    resolveOwner: resolveAgentOwner,
    resolveAgentName,
    resolveEvent: (agentId, event) => resolveInitializationPair(agentId, event),
    deliveryConcurrency: config.runtimeDeliveryConcurrency,
  });
  deliverOnReady = async (agentId) => {
    if (!(await runtimeDelivery.contributionsProgress(agentId)).settled)
      await runtimeDelivery.queue.enqueue(agentId);
  };
  const firePair = composeFirePair({
    db,
    catalog: harnessCatalog,
    getCapabilities: async (agentId) =>
      (await runtimeDelivery.agentsRuntimeRepo.get(agentId))
        ?.runtimeCapabilities ?? null,
    specHarness: async (agentId) =>
      (await agentsRepo.get(agentId))?.spec.harness,
  });
  let convertDefault: (agentId: string) => Promise<unknown> = async () => {};
  const resolveInitializationPair = createInitializationPairResolver({
    firePair: async (agentId, preferred) => {
      await convertDefault(agentId);
      return firePair(agentId, "chat", preferred);
    },
    log: (msg) => getLogger().warn(msg),
  });
  const outcomePairFields = async (
    agentId: string,
  ): Promise<Record<string, unknown>> =>
    sessionPairFields(
      await firePair(agentId, "chat", {}).catch((err: unknown) => {
        if (!isNoDefaultModelError(err)) throw err;
        getLogger().info(
          { err, agentId },
          "outcome turn: no saved default to run it on",
        );
        return null;
      }),
    );
  const harnessConfigReset = composeHarnessConfigReset({
    db,
    outboxRepo: runtimeDelivery.outboxRepo,
    runtimeMutator: runtimeDelivery.runtimeMutator,
    ownerOf: (agentId) => agentsRepo.getOwner(agentId),
    log: (message) => process.stderr.write(`${message}\n`),
  });
  void harnessConfigReset
    .run()
    .catch((err: unknown) =>
      getLogger().warn({ err }, "harness-config reset failed"),
    );
  await periodicJobs.register("starter-kits-refresh", 600_000, () =>
    starterKitsRefresh.run(),
  );
  void starterKitsRefresh
    .run()
    .catch((err: unknown) =>
      getLogger().warn({ err }, "starter kits: initial refresh failed"),
    );

  await periodicJobs.register("runtime-outbox-sweep", 60_000, () =>
    runtimeDelivery.sweep.tick(),
  );
  const onboardingChecklists = createOnboardingChecklistRepository(db);

  let deliverSatelliteOutcome: (
    agentId: string,
  ) => Promise<boolean> = async () => false;
  const satellitesBoot = composeSatellitesModule({
    db,
    maxConcurrentCeiling: config.satelliteMaxConcurrentCeiling,
    ownerOf: (agentId) => agentsRepo.getOwner(agentId),
    agentName: async (agentId) => (await agentsRepo.get(agentId))?.name ?? null,
    isAgentOwnedBy: (agentId, ownerSub) =>
      agentsRepo.isOwnedBy(agentId, ownerSub),
    spillLog: async (agentId, ref, output) => {
      try {
        return await createAgentWorkspaceFiles(agentId, config.namespace).write(
          {
            path: `.dam/satellite-jobs/${ref.replace("#", "-")}.log`,
            bytes: Buffer.from(output, "utf8"),
            contentType: "text/plain",
          },
        );
      } catch {
        return null;
      }
    },
    deliverOutcome: async ({ agentId }) => {
      await deliverSatelliteOutcome(agentId);
    },
  });

  const outcomeDeliveryDeps = {
    repo: satellitesBoot.repo,
    pairFields: outcomePairFields,
    bump: (
      agentId: string,
      events: Parameters<typeof runtimeDelivery.runtimeMutator.bump>[1],
    ) => runtimeDelivery.runtimeMutator.bump(agentId, events),
    enqueue: (agentId: string) =>
      runtimeDelivery.runtimeMutator.enqueueAfterCommit(agentId),
    wakeUnlessStopped: (agentId: string) =>
      agentsRepo.wakeUnlessStopped(agentId),
    spillLog: satellitesBoot.spillLog,
    log: (msg: string) => {
      process.stderr.write(`${msg}\n`);
    },
  };
  deliverSatelliteOutcome = createOutcomeDelivery(outcomeDeliveryDeps);
  await periodicJobs.register("satellite-lease-sweep", 60_000, () =>
    satellitesBoot.sweepLeases().then(() => undefined),
  );
  const retrySatelliteOutcomes = createOutcomeWakeRetry(
    outcomeDeliveryDeps,
    deliverSatelliteOutcome,
  );
  await periodicJobs.register("satellite-outcome-wake-retry", 3_600_000, () =>
    retrySatelliteOutcomes().then(() => undefined),
  );

  const contributionsProgressPort = {
    status: runtimeDelivery.contributionsStatus,
    statusMany: runtimeDelivery.contributionsStatusMany,
    progress: runtimeDelivery.contributionsProgress,
    retryWorkspaceMutation: runtimeDelivery.retryWorkspaceMutation,
  };
  const subPseudonymizer = createSubPseudonymizer(config.activityHmacKey);

  const secretStore = createKubernetesSecretStore({ k8s: k8sClient });

  const OAUTH_FLOW_TTL_MS = 10 * 60 * 1000;
  const SLACK_INSTALL_HANDOFF_TTL_MS = 24 * 60 * 60 * 1000;
  const connectionsBoot = composeConnectionsAtBoot({
    db,
    shareBaseUrl: config.shareBaseUrl,
    curveBenderDeployment: config.curveBenderDeployment !== null,
    e2eEnabled: config.e2eEnabled,
    secretStore,
    pendingFlowStore: createRedisTtlStore(
      sharedRedis,
      "oauth:connections",
      OAUTH_FLOW_TTL_MS,
    ),
    secretRequestStores: {
      pending: createRedisTtlStore(
        sharedRedis,
        "connections:secret-request",
        SECRET_REQUEST_TTL_MS,
      ),
      outcomes: createRedisTtlStore(
        sharedRedis,
        "connections:secret-request-outcome",
        SECRET_REQUEST_TTL_MS,
      ),
    },
    operatorCredentials: {
      ...(config.defaultGithubClientId && config.defaultGithubClientSecret
        ? {
            github: {
              clientId: config.defaultGithubClientId,
              clientSecret: config.defaultGithubClientSecret,
              ...(config.defaultGithubAppSlug
                ? { appSlug: config.defaultGithubAppSlug }
                : {}),
            },
          }
        : {}),
      githubEnterprise: {
        ...(config.defaultGithubEnterpriseHost
          ? { host: config.defaultGithubEnterpriseHost }
          : {}),
        ...(config.defaultGithubEnterpriseClientId
          ? { clientId: config.defaultGithubEnterpriseClientId }
          : {}),
        ...(config.defaultGithubEnterpriseClientSecret
          ? { clientSecret: config.defaultGithubEnterpriseClientSecret }
          : {}),
        ...(config.defaultGithubEnterpriseAppSlug
          ? { appSlug: config.defaultGithubEnterpriseAppSlug }
          : {}),
      },
      ...(config.defaultSlackClientId && config.defaultSlackClientSecret
        ? {
            slack: {
              clientId: config.defaultSlackClientId,
              clientSecret: config.defaultSlackClientSecret,
            },
          }
        : {}),
    },
  });
  const connectionsServiceFor = (ownerId: string) =>
    composeConnectionsForOwner({
      ownerId,
      db,
      templates: connectionsBoot.templates,
      oauthEngine: connectionsBoot.oauthEngine,
      githubAppEngine: connectionsBoot.githubAppEngine,
      s3CredentialProbe: connectionsBoot.s3CredentialProbe,
      providerKeyProbe: connectionsBoot.providerKeyProbe,
      secretStore,
      runtimeMutator: runtimeDelivery.runtimeMutator,
      agentsRepo,
      connectionRulesSync: createConnectionRulesSyncAdapter(db),
      oauthCallbackUrl: oauthCallbackUrl(config.uiBaseUrl),
      brandName: config.brand.name,
      curveBenderDeploymentKey: config.curveBenderDeployment?.apiKey ?? null,
      harnesses: harnessCatalog,
    });
  await periodicJobs
    .register("oauth-refresh", 60_000, () =>
      connectionsBoot.refreshLoop.tickOnce(),
    )
    .catch((err) => {
      getLogger().error(
        `periodic job oauth-refresh registration failed: ${formatError(err)}`,
      );
      process.exit(1);
    });
  await periodicJobs
    .register("connection-account-label-backfill", 3_600_000, () =>
      connectionsBoot.accountLabelBackfill.tickOnce(),
    )
    .catch((err) => {
      getLogger().error(
        `periodic job connection-account-label-backfill registration failed: ${formatError(err)}`,
      );
      process.exit(1);
    });

  const { service: termsService, isAcceptedPort: isTermsAccepted } =
    composeTermsModule({
      db,
      version: config.terms.version,
      text: config.terms.text,
      signUps: config.signUps,
    });

  const fakeSlackGateway =
    config.e2eEnabled && !config.slackAppToken
      ? createFakeSlackGateway()
      : undefined;
  const fakeSlackRotation = fakeSlackGateway
    ? createFakeSlackTokenRotation()
    : undefined;

  const { service: e2eService } = composeE2eModule({
    namespace: config.namespace,
    slack: fakeSlackGateway,
    ...(fakeSlackGateway && fakeSlackRotation
      ? {
          slackInstalls: {
            record: (install) => slackInstalls.record(install),
            importHelmToken: (teamId, token) =>
              slackInstalls.importHelmToken(teamId, token),
            renewAll: () => slackInstalls.renewAll(),
            resolveBotToken: (teamId) => slackInstalls.resolveBotToken(teamId),
            forgetBotToken: (teamId) => slackInstalls.forgetBotToken(teamId),
            rotation: fakeSlackRotation,
          },
        }
      : {}),
  });

  const publicAgentPage = composePublicAgentPage({
    db,
    repo: agentsRepo,
    userDirectory,
    log: (m) => getLogger().warn(`[public-agent-profile] ${m}`),
  });
  const publicAgentProfileSub = publicAgentPage.startSaga();
  const attachFirstProviderSub = startAttachFirstProviderSaga(
    async (owner, connectionId) =>
      attachProviderToBareAgents(
        connectionsServiceFor(owner),
        harnessCatalog,
        await agentsRepo.list(owner),
        connectionId,
      ),
  );
  sweepManagedConnections(
    () => listManagedConnectionOwners(db),
    connectionsServiceFor,
  ).catch((err: unknown) =>
    getLogger().error(
      { reason: formatError(err) },
      "connections.managed_provider_sweep_failed",
    ),
  );
  const publicAgentPageService = publicAgentPage.service;
  await periodicJobs.register(
    "public-agent-profile-reconcile",
    60 * 60_000,
    async () => {
      const { deleted, failed } =
        await publicAgentPage.reconcileService.reconcile();
      if (deleted > 0 || failed > 0)
        getLogger().info(
          `[public-agent-profile] marked ${deleted} profile(s) deleted, ${failed} failed`,
        );
    },
  );
  const agentSkillsRepo = createAgentSkillsRepository(db);
  const kbShareAutoRefresh = startKbShareSync({
    db,
    namespace: config.namespace,
  });
  const usageMetrics = composeUsageMetricsModule({
    meter: metrics.getMeter("platform-apiserver"),
    stateCounts: createStateCountsRepository(db),
    harnessOf: (agentId) => {
      const agent = agentsRepo.peekCached(agentId);
      return agent
        ? { agent: "resolved", harness: agent.spec.harness }
        : { agent: "unresolved" };
    },
    knownHarnesses: new Set([
      ...Object.keys(config.harnesses.catalog),
      ...(await templatesRepo.list()).flatMap((t) => t.spec.harness ?? []),
    ]),
    now: () => Date.now(),
  });
  usageMetrics.start();
  const seedSources = parseSeedSources(config.skillSourcesSeed);

  const usage = composeUsageModule({
    db,
    subPseudonymizer,
    activityTrackingEnabled: config.activityTrackingEnabled,
    inspectorRole: config.keycloakInspectorRole ?? "",
    listK8sAgents: async () => {
      const agents = await k8sClient.listCustomObjects(AGENTS_PLURAL);
      return agents
        .filter((a) => a.metadata?.name && a.metadata?.labels?.[LABEL_OWNER])
        .map((a) => {
          const annotations = a.metadata?.annotations ?? {};
          const kitRef = annotations[ANN_STARTER_KIT];
          return {
            id: a.metadata!.name!,
            owner: a.metadata!.labels![LABEL_OWNER]!,
            starterKit: kitRef ? (parseKitRef(kitRef)?.kitId ?? null) : null,
            onboardedAt: annotations[ANN_STARTER_KIT_ONBOARDED] ?? null,
          };
        });
    },
    listLiveAgents: () => agentStateCache.list(),
    agentSizing: {
      slot: {
        cpu: config.agentDefaultCpuLimit,
        memory: config.agentDefaultMemoryLimit,
      },
      defaultStorage: config.agentDefaultStorageSize,
      idleTimeoutMinutes: config.agentIdleTimeoutMinutes,
    },
  });
  usage.start();
  if (config.activityTrackingEnabled) {
    await periodicJobs.register(
      "activity-retention",
      7 * 24 * 60 * 60 * 1000,
      () => usage.retentionTick(),
    );
  }

  const audit = composeAuditModule();
  audit.start();

  const gettingStarted = composeGettingStartedModule({
    db,
    ownedAgentIds: async (owner) =>
      (await agentsRepo.list(owner)).map((a) => a.id),
  });
  gettingStarted.start();

  const sidebarOrder = composeSidebarOrderModule({ db });

  const caseStudies = composeCaseStudiesModule({
    db,
    inspectorRole: config.keycloakInspectorRole ?? "",
    retentionDays: config.caseStudiesRetentionDays,
    graceDays: config.caseStudiesTombstoneGraceDays,
  });
  const metricsReader = composeMetricsReader(config);
  const telemetryReader = composeTelemetryReader(config);
  const { converter: defaultConverter, helloSaga: defaultConversionSaga } =
    composeDefaultConverter({
      db,
      namespace: config.namespace,
      catalog: harnessCatalog,
      getCapabilities: async (agentId) =>
        (await runtimeDelivery.agentsRuntimeRepo.get(agentId))
          ?.runtimeCapabilities ?? null,
      specHarness: async (agentId) =>
        (await agentsRepo.get(agentId))?.spec.harness,
      kitDefaultModel: async (agentId) =>
        (await agentsRepo.get(agentId))?.starterKitDefaultModel ?? null,
      modelsRanBy: async (agentId, hours) =>
        metricsReader
          ? (await metricsReader.tokenSpendByModel([agentId], { hours }))
              .sort((a, b) => b.outputTokens - a.outputTokens)
              .map((r) => r.model)
          : [],
      movedToNewImage: async (agentId) =>
        (await agentsRepo.get(agentId))?.imageUpdateFrom !== undefined,
      isRunning: (agentId) => agentsRepo.isReady(agentId),
      wake: (agentId) => agentsRepo.wakeIfHibernated(agentId),
      lastHelloAt: async (agentId) =>
        (
          await runtimeDelivery.agentsRuntimeRepo.get(agentId)
        )?.runtimeLastHelloAt?.getTime() ?? null,
      ownerOf: async (agentId) => (await agentsRepo.get(agentId))?.owner,
      runtimeMutator: runtimeDelivery.runtimeMutator,
      log: (msg) => getLogger().info(msg),
    });
  convertDefault = (agentId) => defaultConverter.convert(agentId);

  const sessionWatcher = composeSessionWatcher({
    db,
    namespace: config.namespace,
    listAgents: () => agentsRepo.list(),
    runtimeFeaturesFor: (ids) => runtimeDelivery.runtimeFeaturesMany(ids),
    log: (m) => getLogger().warn(`[attention] ${m}`),
  });

  const liveEventsModule = composeLiveEventsModule({
    bus: redisBus,
    log: (m) => getLogger().warn(`[live-events] ${m}`),
    k8s: k8sClient,
    onAgentChanged: (agentId) => {
      sessionWatcher.agentsChanged();
      const cached = agentStateCache.peekCached(agentId);
      if (cached) resourceAlerts.agentChanged(parseInfraAgent(cached));
    },
  });
  liveEventsModule.start();
  const agentWatchRole: LeaderRole = {
    name: "live-events-agent-watch",
    onAcquired: () => liveEventsModule.startAgentWatch(),
    onLost: () => liveEventsModule.stopAgentWatch(),
  };

  const sessionWatcherRole: LeaderRole = {
    name: "attention-watcher",
    onAcquired: () => sessionWatcher.start(),
    onLost: () => sessionWatcher.stop(),
  };

  const loopGuardDrops = createSlackLoopGuardDropsRepository(db);
  const { agents: systemAgents } = composeAgentsModule({
    cleanupHooks: [],
    readSlackLoopGuardDrops: (ids) => loopGuardDrops.readMany(ids),
    install: agentsInstallSettings(config),
    api,
    resolveSlackWorkspace: (slackChannelId) =>
      resolveSlackWorkspace(slackChannelId),
    agentStateCache,
    namespace: config.namespace,
    agentIdleTimeoutMinutes: config.agentIdleTimeoutMinutes,
    agentDefaultLimits: {
      cpu: config.agentDefaultCpuLimit,
      memory: config.agentDefaultMemoryLimit,
    },
    owner: undefined,
    db,
    readTemplateSpec: async () => null,
    runtimeMutator: runtimeDelivery.runtimeMutator,
    contributionsProgress: contributionsProgressPort,
    onboardingChecklists,
  });

  const identityLinkService = createIdentityLinkService({
    findByExternalUser: findIdentityByExternalUser(db),
    findExternalUsers: findExternalUsersByIdentity(db),
    findExternalLinks: findExternalLinksByIdentity(db),
    upsert: upsertIdentityLink(db),
    delete: deleteIdentityLink(db),
  });

  const pendingSlackOAuthFlows = createRedisTtlStore<SlackOAuthPending>(
    sharedRedis,
    "oauth:slack",
    OAUTH_FLOW_TTL_MS,
  );
  const pendingTelegramOAuthFlows = createRedisTtlStore<TelegramOAuthPending>(
    sharedRedis,
    "oauth:telegram",
    OAUTH_FLOW_TTL_MS,
  );
  const telegramBindFlows = config.telegramBotToken
    ? createFlowStore<TelegramPendingBind>({
        store: createRedisTtlStore(
          sharedRedis,
          "bind:telegram",
          OAUTH_FLOW_TTL_MS,
        ),
      })
    : undefined;
  const slackBindFlows = createFlowStore<SlackPendingBind>({
    store: createRedisTtlStore(sharedRedis, "bind:slack", OAUTH_FLOW_TTL_MS),
  });
  const slackOauthCallbackUrl =
    config.slackOauthCallbackUrl ??
    `${config.uiBaseUrl}/api/slack/oauth/callback`;
  const slackInstallCallbackUrl =
    config.slackInstallCallbackUrl ??
    `${config.uiBaseUrl}/api/slack/install/callback`;
  const telegramOauthCallbackUrl = `${config.uiBaseUrl}/api/telegram/oauth/callback`;

  const pendingSlackInstalls = createRedisTtlStore<SlackInstallPending>(
    sharedRedis,
    "install:slack",
    SLACK_INSTALL_HANDOFF_TTL_MS,
  );
  const slackTokenRotation: SlackTokenRotation =
    fakeSlackRotation ??
    (config.slackClientId && config.slackClientSecret
      ? createSlackTokenRotation({
          clientId: config.slackClientId,
          clientSecret: config.slackClientSecret,
        })
      : noSlackTokenRotation);
  const listActiveSlackWorkspaces = async () =>
    (await listSlackInstalls(db)())
      .filter((i) => i.credentialState === "active")
      .map((i) => i.teamId);
  const slackInstalls = createSlackInstallService({
    find: findSlackInstall(db),
    list: listSlackInstalls(db),
    claimUnscopedBindings: claimUnscopedSlackBindings(db),
    upsert: upsertSlackInstall(db),
    setState: setSlackCredentialState(db),
    secrets: secretStore,
    installLock: createXactLock(db),
    rotation: slackTokenRotation,
    exchangeLongLivedTokens:
      config.slackTokenRotation || fakeSlackRotation !== undefined,
  });

  const chatSdkDatabaseUrl = config.databaseCaCertPath
    ? `${config.databaseUrl}${config.databaseUrl.includes("?") ? "&" : "?"}sslrootcert=${config.databaseCaCertPath}`
    : config.databaseUrl;
  const chatSdkState = config.telegramBotToken
    ? createPostgresState({ url: chatSdkDatabaseUrl, keyPrefix: "chat-sdk" })
    : undefined;

  const invocationDriverResolution = createDriverResolutionAdapter(db);
  const payerOf = async (agentId: string) =>
    (await invocationDriverResolution.resolveRoot(agentId)) ?? agentId;

  const { sessionDirectory, retentionTick: sessionDirectoryRetentionTick } =
    composeSessionDirectory(db);
  const spend = composeSpendSystem({
    db,
    redis: sharedRedis,
    priceOverrides: config.spendPriceOverrides,
    owners: {
      ownerOf: async (agentId) =>
        (await agentsRepo.resolveIdentity(agentId))?.owner ?? null,
    },
    payers: { payerOf },
    questions: createSpendQuestionStore(db),
    connections: createGrantedConnectionTemplates(db),
    users: {
      subByEmail: (email) => userDirectory.resolveByEmail(email),
      emailsBySub: (subs) => userDirectory.resolveManyBySub([...subs]),
    },
    defaultCeilingMicros: config.spendDefaultUserCeilingMicros,
    brandName: config.brand.name,
    connectionNames: createConnectionNames(db),
    agentNames: {
      namesOf: async (ownerSub) =>
        new Map(
          (await agentsRepo.list(ownerSub)).map((agent) => [
            agent.id,
            agent.name,
          ]),
        ),
    },
    invocationTasks: createInvocationTasksAdapter(db),
    ownedAgents: {
      anyCreatedBefore: async (ownerSub, at) =>
        (await agentsRepo.list(ownerSub)).some(
          (agent) =>
            agent.createdAt !== undefined &&
            Date.parse(agent.createdAt) < at.getTime(),
        ),
    },
    sessions: sessionDirectory,
    subAgents: createSpawnSessionsAdapter(db),
    telemetryStoreOn: metricsReader !== null,
  });
  await periodicJobs.register("spend-unrecorded-calls", 5 * 60_000, () =>
    spend.ingest.settleUnrecordedCalls(),
  );
  await periodicJobs.register(
    "spend-call-rows-retention",
    24 * 60 * 60 * 1000,
    () => spend.callRowsRetentionTick(),
  );
  const providerStatus = composeProviderStatus({
    redis: sharedRedis,
    connectedTemplates: listConnectionTemplateIds(db),
  });
  const providerStatusSaga = providerStatus.startSaga();
  await periodicJobs.register("provider-status-evaluate", 60_000, () =>
    providerStatus.service.evaluate(new Date()),
  );

  const spendQuestions = composeSpendLimitQuestions(db);
  const spendHold = async ({
    agentId,
    connectionId,
  }: {
    agentId: string;
    connectionId?: string;
  }) => {
    const payer = await payerOf(agentId);
    const hold = await spend.check.holdFor({
      payer,
      ...(connectionId ? { connectionId } : {}),
    });
    if (hold === null) return null;
    await spendQuestions.ask({
      agentId: payer,
      ownerSub: hold.ownerSub,
      questions: hold.questions,
    });
    return hold.reason;
  };
  const channelSpendHold = async (agentId: string) => {
    const provider = (
      await firePair(agentId, "channel", {}).catch((err: unknown) => {
        if (isNoDefaultModelError(err)) return undefined;
        throw err;
      })
    )?.provider;
    return spendHold({
      agentId,
      ...(provider ? { connectionId: provider } : {}),
    });
  };

  const channelRegistry: ChannelRegistry = {
    resolveSlackBindings: async (slackChannelId) => {
      const rows = await findSlackBindingsByChannelId(db)(slackChannelId);
      return rows.map((row) => ({
        instanceName: row.agentId,
        owner: row.owner,
        teamId: row.teamId,
        ambient: row.ambient,
        isDefault: row.isDefault,
      }));
    },
    resolveSlackChannelsByInstance: findSlackChannelsByAgent(db),
  };

  const slackAppToken = config.slackAppToken;

  const slackGatewayFactory = slackAppToken
    ? () =>
        createBoltSlackGateway({
          resolveBotToken: slackInstalls.resolveBotToken,
          importHelmToken: slackInstalls.importHelmToken,
          renewTokens: slackInstalls.renewAll,
          forgetBotToken: slackInstalls.forgetBotToken,
          helmBotToken: config.slackBotToken,
          appToken: slackAppToken,
          commandName: `/${config.brand.short}`,
          onCredentialRejected: slackInstalls.markRejected,
        })
    : fakeSlackGateway
      ? () => fakeSlackGateway
      : undefined;

  const channelFirePair = composeConvertingFirePair(defaultConverter, firePair);
  const makeAcpClient: AcpClientFactory = (instanceName) =>
    createAcpClient({
      namespace: config.namespace,
      instanceName,
      stallProbeMs: config.acpTurnStallProbeSeconds * 1000,
      firePair: (agentId) => channelFirePair(agentId, "channel"),
    });

  const agentApiClient = createAgentApiClient(config.namespace);
  const shareBridge = composeShareBridge({
    featureOn: async (owner) =>
      (
        await composeFeaturesForOwner({
          db,
          owner,
          surface: "system",
          modes: config.featureModes,
        }).features.flags()
      )["interactive-artifacts"],
    ensureReady: (agentId) => agentsRepo.ensureReady(agentId),
    agentApi: agentApiClient,
    makeAcpClient,
    spendHold: channelSpendHold,
    attendance: turnAttendance,
  });
  const kbShareServing = composeKbShareServing({
    db,
    store: artifacts,
    k8s: k8sClient,
    grepDeadlineMs: config.kbShareGrepDeadlineMs,
  });
  const shareHostGate = createByLinkHostGate(
    shareSignIns.map((signIn) => ({
      share: {
        baseUrl: signIn.set.shareBaseUrl,
        app: createShareHostApp({
          auth: createShareAuthRoutes({
            auth: signIn.auth,
            brandName: config.brand.name,
            sessionCookie: signIn.cookie,
          }),
          viewer: createShareViewerApp({
            viewer: shareViewer,
            auth: signIn.auth,
            sessionCookie: signIn.cookie,
            renderTokens: shareRenderTokens,
            relayTokens: shareRelayTokens,
            brandName: config.brand.name,
            uiBaseUrl: signIn.set.uiBaseUrl,
            contentBaseUrl: signIn.set.contentBaseUrl,
            shareBaseUrl: signIn.set.shareBaseUrl,
            bridge: shareBridge,
          }),
          environments:
            signIn === publicShareSignIn ? environmentFrontDoor : null,
          kbMcp: kbShareServing,
        }),
      },
      content: {
        baseUrl: signIn.set.contentBaseUrl,
        app: createContentApp({
          viewer: shareViewer,
          renderTokens: shareRenderTokens,
          shareBaseUrl: signIn.set.shareBaseUrl,
        }),
      },
    })),
  );

  const agentIcons =
    slackGatewayFactory && config.imgbbApiKey
      ? createImgbbAgentIcons({
          apiKey: config.imgbbApiKey,
          store: createPublicImageUrlsRepository(db),
          loadImage: createAvatarImagesRepository(db).load,
        })
      : null;
  void agentIcons?.warm();

  const slackWorker = slackGatewayFactory
    ? createSlackWorker({
        makeAcpClient,
        createGateway: slackGatewayFactory,
        agents: () => systemAgents,
        identityLinks: identityLinkService,
        oauthConfig: {
          keycloakExternalUrl: config.keycloakExternalUrl,
          keycloakUrl: config.keycloakUrl,
          keycloakRealm: config.keycloakRealm,
          keycloakClientId: config.keycloakClientId,
          callbackUrl: slackOauthCallbackUrl,
        },
        pendingOAuthFlows: pendingSlackOAuthFlows,
        getInstanceOwner: (agentId) => agentsRepo.getOwner(agentId),
        channelRegistry,
        unbindSlackChannel: deleteSlackChannelBinding(db),
        setSlackChannelAmbient: setSlackChannelAmbient(db),
        agentsFor: (owner) => harnessAgentsServiceFor(owner),
        ignoredApps: createSlackIgnoredAppsRepository(db),
        loopGuardDrops,
        setSlackDefault: setSlackChannelDefault(db),
        brand: { name: config.brand.name, short: config.brand.short },
        isTermsAccepted,
        spendHold: channelSpendHold,
        uiBaseUrl: config.uiBaseUrl,
        attendance: turnAttendance,
        workspaceFiles: (agentId) =>
          createAgentWorkspaceFiles(agentId, config.namespace),
        listWorkspaces: listActiveSlackWorkspaces,
        settleMs: DEFAULT_SETTLE_MS,
        agentIcon: agentIcons?.iconUrl ?? null,
        readPodRestarts: async (agentId) => {
          const agent = await agentsRepo.get(agentId);
          return agent
            ? { restarts: agent.podRestarts, reason: agent.podRestartReason }
            : null;
        },
      })
    : undefined;

  const resolveSlackWorkspace = createSlackWorkspaceProbe({
    listInstalledWorkspaces: async () => [
      ...(fakeSlackGateway ? [FAKE_WORKSPACE] : []),
      ...(await listActiveSlackWorkspaces()),
    ],
    conversationStanding: async (slackChannelId, teamId) =>
      channelManager.slackConversationStanding(slackChannelId, teamId),
  });

  const telegramWorker =
    config.telegramBotToken && chatSdkState
      ? createTelegramWorker({
          botToken: config.telegramBotToken,
          configuredBotUsername: config.telegramBotUsername,
          makeAcpClient,
          state: chatSdkState,
          agents: () => systemAgents,
          conversations: {
            findAgentByConversation: findAgentByConversation(db),
            bind: bindConversation(db),
            listByAgent: listConversationsByAgent(db),
            listAuthorizedBy: listConversationsAuthorizedBy(db),
            unbind: unbindConversation(db),
            setAmbient: setConversationAmbient(db),
          },
          oauthConfig: {
            keycloakExternalUrl: config.keycloakExternalUrl,
            keycloakUrl: config.keycloakUrl,
            keycloakRealm: config.keycloakRealm,
            keycloakClientId: config.keycloakClientId,
            callbackUrl: telegramOauthCallbackUrl,
          },
          pendingOAuthFlows: pendingTelegramOAuthFlows,
          isTermsAccepted,
          ownerOf: (agentId) => agentsRepo.getOwner(agentId),
          spendHold: channelSpendHold,
          uiBaseUrl: config.uiBaseUrl,
          brandName: config.brand.name,
          logLevel: config.logLevel,
          attendance: turnAttendance,
          settleMs: DEFAULT_SETTLE_MS,
        })
      : undefined;

  const channelRpc = createBusRpc<ChannelRpcRequest, unknown>({
    bus: redisBus,
    service: "channels",
    requestSchema: channelRpcRequestSchema,
    claim: async (id) =>
      (await sharedRedis.set(
        `rpc:claim:channels:${id}`,
        "1",
        "EX",
        60,
        "NX",
      )) === "OK",
  });

  const channelManager = createChannelManager({
    slackWorker,
    telegramWorker,
    rpc: channelRpc,
    blobs: createRedisBlobHandoff(sharedRedis),
    isLeader: () => leaderLease.isRunning("channels"),
  });

  const resourceAlerts = composeResourceAlerts({
    db,
    notify: (ownerSub, text) =>
      channelManager.notifyPerson(ownerSub, { slack: text }),
    listStorageOwners: () => listRunnerUsageOwners(k8sClient),
    readStorage: async (ownerSub) =>
      (await readRunnerUsage(k8sClient, ownerSub))?.storage ?? null,
    listOwnerAgents: async (ownerSub) =>
      (await agentStateCache.list(ownerSub)).map(parseInfraAgent),
    uiBaseUrl: config.uiBaseUrl,
    log: (m) => getLogger().warn(`[resource-alerts] ${m}`),
  });
  await periodicJobs.register("resource-alerts", 5 * 60_000, () =>
    resourceAlerts.evaluateStorage(),
  );

  const leaderLease = createLeaderLease({
    leases: leaseApi,
    namespace: config.namespace,
    name: `${config.releaseName}-apiserver`,
    roles: [
      {
        name: "channels",
        onAcquired: async () => {
          const channelsByInstance = await listChannelsByOwner(db, "")();
          await channelManager.bootstrap(channelsByInstance);
        },
        onLost: () => channelManager.standDown(),
      },
      agentWatchRole,
      sessionWatcherRole,
      usageMetrics.stateGaugesRole,
    ],
    log: (m) => getLogger().info(`[leader] ${m}`),
  });

  const trustedHosts = loadTrustedHosts(config.trustedHostsPath);
  const presetSeeder = createPresetSeederAdapter(db, trustedHosts);
  await markTrustedRowsTakenOverAdapter(db, trustedHosts)
    .then((marked) => {
      if (marked > 0)
        getLogger().info(
          { marked },
          "egress-rules: marked preset rows taken over by connections",
        );
    })
    .catch((err) => {
      getLogger().warn(
        `egress-rules: marking preset rows taken over by connections failed: ${formatError(err)}`,
      );
    });

  const wrapperFrameSender = createWrapperFrameSender({
    resolveWrapperUrl: (agentId) =>
      `ws://${agentServiceAddress(agentId, config.namespace)}/api/acp`,
  });

  const objectStoreAgentUrl = config.objectStorageAgentEndpoint
    ? new URL(config.objectStorageAgentEndpoint)
    : null;
  const {
    relay: approvalsRelay,
    gate: extAuthzGate,
    sweeper: deliverySweeper,
    wakeSaga: approvalsWakeSaga,
  } = composeApprovalsSystem({
    db,
    bus: redisBus,
    identityResolver: createEgressIdentityResolver({
      resolveRoot: (agentId) => invocationDriverResolution.resolveRoot(agentId),
      identityOf: (agentId) => agentsRepo.resolveIdentity(agentId),
      environmentName: environmentNameLookup(db),
    }),
    ruleMatcher: createEgressRuleMatchAdapter(db),
    providerScopes: createProviderEgressScopes(db),
    attendance: turnAttendance,
    spend: spend.check,
    wrapperFrameSender,
    holdSeconds: config.approvalHoldSeconds,
    platformAllowedAuthorities: objectStoreAgentUrl
      ? [
          `${objectStoreAgentUrl.hostname}:${objectStoreAgentUrl.port || (objectStoreAgentUrl.protocol === "https:" ? 443 : 80)}`,
        ]
      : [],
  });
  if (config.slackAppToken) {
    await periodicJobs.register("slack-token-renew", 10 * 60_000, () =>
      slackInstalls.renewAll(),
    );
  }
  await periodicJobs.register("approvals-delivery-sweep", 30_000, () =>
    deliverySweeper.tick(),
  );

  const registrySecretPort = createAgentRegistrySecretPort(k8sClient);

  const scheduleModelFor = composeScheduleModelForFire({
    db,
    getCapabilities: async (agentId) =>
      (await runtimeDelivery.agentsRuntimeRepo.get(agentId))
        ?.runtimeCapabilities ?? null,
  });
  const schedulesBoot = composeSchedulesAtBoot({
    db,
    firePair,
    agentOnceLimits: {
      maxOpen: config.onceScheduleAgentMaxOpen,
      maxPerHour: config.onceScheduleAgentMaxPerHour,
    },
    validateSessionChoices: composeSessionChoicesValidator({
      db,
      catalog: harnessCatalog,
      getCapabilities: async (agentId) =>
        (await runtimeDelivery.agentsRuntimeRepo.get(agentId))
          ?.runtimeCapabilities ?? null,
      firePair,
    }),
    bullConnection,
    runtimeMutator: runtimeDelivery.runtimeMutator,
    wakeAgent: (agentId) => agentsRepo.wakeIfHibernated(agentId),
    ensureDefault: (agentId) => defaultConverter.ensureForFire(agentId),
    scheduleModelFor,
    defaultPendingAfterMove: async (agentId) => {
      if (!(await defaultConverter.pendingAfterMove(agentId))) return false;
      void defaultConverter
        .ensureForFire(agentId)
        .catch((err: unknown) =>
          getLogger().warn({ err, agentId }, "default conversion failed"),
        );
      return true;
    },
    restoreActivity: (agentId, stamp) =>
      agentsRepo.restoreActivityIfUnchanged(agentId, stamp),
    redis: sharedRedis,
    onboardingPending: async (agentId) => {
      const agent = await agentsRepo.get(agentId);
      return (
        agent?.starterKit !== undefined &&
        agent.starterKitOnboarded === undefined
      );
    },
    spendHold,
    agentDisabled: async (agentId) =>
      (await agentsRepo.get(agentId))?.disabled === true,
  });

  const grantedTemplates = createGrantedConnectionTemplates(db);
  const outageAlerts = composeOutageAlerts({
    db,
    notify: (ownerSub, notice) => channelManager.notifyPerson(ownerSub, notice),
    describeAgent: async (agentId) => {
      const agent = await agentsRepo.get(agentId);
      return agent?.owner
        ? { ownerSub: agent.owner, name: agent.name, disabled: agent.disabled }
        : null;
    },
    unattendedCandidates: createUnattendedAgentsReader(db),
    enabledSchedules: async (agentIds) =>
      (await schedulesBoot.repo.listEnabledByAgents(agentIds)).map((s) => ({
        agentId: s.agentId,
        continuesSession:
          s.spec.type === "once" && s.spec.origin?.mode === "continue",
        harness: s.spec.harness,
        model: s.spec.model,
      })),
    fireTemplate: async (agentId, kind, choices) => {
      const model =
        kind === "scheduled" && choices.model
          ? await scheduleModelFor(agentId, choices.model)
          : undefined;
      const pair = await firePair(agentId, kind, {
        ...(choices.harness && { harness: choices.harness }),
        ...(model && { model }),
      }).catch((err: unknown) => {
        if (isNoDefaultModelError(err)) return null;
        throw err;
      });
      if (pair === null) return null;
      if (pair === undefined || pair.provider === null) return undefined;
      return grantedTemplates.templateOf(agentId, pair.provider);
    },
    uiBaseUrl: config.uiBaseUrl,
    delayMs: config.outageAlertDelayMinutes * 60_000,
  });
  const outageAlertsSaga = outageAlerts.startSaga();
  runtimeDelivery.registerEventOutcomeHandler(
    "trigger",
    async (event, input) => {
      const { scheduleId, precheck, once } =
        event.payload as Partial<TriggerEventPayload>;
      if (!scheduleId) return;
      if (once) {
        if (input.outcome === "failed")
          await schedulesBoot.runner.recordOnceFailure(
            scheduleId,
            input.detail ?? "the one-time task could not start",
          );
        return;
      }
      if (!precheck && input.stage !== "run") return;
      await schedulesBoot.runner.reportFire({
        scheduleId,
        eventId: input.eventId,
        ranPrecheck: precheck ?? null,
        outcome: input.outcome,
        ...(input.stage ? { stage: input.stage } : {}),
        ...(input.detail ? { detail: input.detail } : {}),
      });
    },
  );
  runtimeDelivery.registerEventLifecycleListener(
    "trigger",
    async (event, transition) => {
      const { scheduleId } = event.payload as Partial<TriggerEventPayload>;
      if (!scheduleId) return;
      await schedulesBoot.runner.recordDelivery(scheduleId, transition);
    },
  );

  const artifactLibraryFor: ArtifactLibraryFor = (owner, surface, opts) =>
    composeArtifactLibraryForOwner({
      db,
      artifacts,
      owner,
      surface,
      shareBaseUrl: config.shareBaseUrl,
      agentExists: opts?.agentExists,
      ensureReady: (agentId) => agentsRepo.ensureReady(agentId),
      agentApi: agentApiClient,
    }).artifactLibrary;
  const artifactLibraryForSystem = (owner: string) =>
    artifactLibraryFor(owner, "system");

  const environments = composeEnvironments({
    db,
    agentsFor: (owner) => harnessAgentsServiceFor(owner),
    listAgents: async () =>
      (await agentsRepo.list()).flatMap((a) =>
        a.owner
          ? [
              {
                id: a.id,
                owner: a.owner,
                environmentOf: a.spec.environmentOf,
                createdAt: new Date(a.createdAt ?? 0),
              },
            ]
          : [],
      ),
    runtimeMutator: runtimeDelivery.runtimeMutator,
    config: {
      urlTemplate: config.environmentsUrl,
      maxPerAgent: config.environmentsMaxPerAgent,
      expiryMaxDays: config.environmentExpiryMaxDays,
    },
  });

  const scriptOutputs = composeScriptOutputs({
    db,
    agentsFor: (owner) => harnessAgentsServiceFor(owner),
    frames: delegationFrames,
    store: artifacts,
  });

  const agentCleanupSources: AgentCleanupSource[] = [
    environments.cleanupSource,
    {
      name: "egress-rules",
      listAgentIds: () => listEgressRuleAgentIds(db),
      cleanup: createEgressRulesCleanupHook(db),
    },
    {
      name: "pending-approvals",
      listAgentIds: () => listPendingApprovalAgentIds(db),
      cleanup: createApprovalsCleanupHook(db),
    },
    {
      name: "spend-limits",
      listAgentIds: () => listSpendLimitAgentIds(db),
      cleanup: createSpendLimitsCleanupHook(db),
    },
    {
      name: "registry-pull-secrets",
      listAgentIds: () => registrySecretPort.listAgentIds(),
      cleanup: (agentId: string) => registrySecretPort.delete(agentId),
    },
    {
      name: "connection-grants",
      listAgentIds: () => listConnectionGrantAgentIds(db),
      cleanup: createConnectionGrantsCleanupHook(db),
    },
    {
      name: "satellite-grants",
      listAgentIds: () => satellitesBoot.listAgentIds(),
      cleanup: satellitesBoot.onAgentDeleted,
    },
    {
      name: "chat-form-preferences",
      ...createChatFormPreferencesCleanup(db),
    },
    {
      name: "sidebar-order",
      listAgentIds: () => sidebarOrder.listAgentIds(),
      cleanup: (agentId: string) => sidebarOrder.deleteForAgent(agentId),
    },
    {
      name: "agent-env",
      listAgentIds: () => agentEnvRepo.listAgentIds(),
      cleanup: (agentId: string) => agentEnvRepo.deleteForAgent(agentId),
    },
    {
      name: "schedules",
      listAgentIds: () => schedulesBoot.repo.listAgentIds(),
      cleanup: createSchedulesCleanupHook(schedulesBoot),
    },
    {
      name: "runtime-delivery",
      listAgentIds: () => runtimeDelivery.outboxRepo.listAgentIds(),
      cleanup: (agentId: string) =>
        runtimeDelivery.outboxRepo.deleteForAgent(agentId),
    },
    {
      name: "invocations",
      listAgentIds: () => listInvocationAgentIds(db),
      cleanup: createInvocationsCleanupHook({
        db,
        agentsFor: (owner) => harnessAgentsServiceFor(owner),
        frames: delegationFrames,
        outputs: scriptOutputs,
      }),
    },
    {
      name: "api-keys",
      listAgentIds: () => listApiKeyAgentIds(db),
      cleanup: createApiKeysCleanupHook(db),
    },
    {
      name: "attention",
      listAgentIds: () => listAttentionAgentIds(db),
      cleanup: createAttentionCleanupHook(db),
    },
    {
      name: "channels",
      listAgentIds: allChannelAgentIds(db),
      cleanup: deleteChannelsByAgent(db),
    },
    {
      name: "telegram-conversations",
      listAgentIds: allConversationAgentIds(db),
      cleanup: deleteConversationsByAgent(db),
    },
    {
      name: "agent-skills",
      listAgentIds: () => agentSkillsRepo.listAgentIds(),
      cleanup: (agentId: string) => agentSkillsRepo.deleteByAgent(agentId),
    },
    {
      name: "kb-shares",
      listAgentIds: () => listKbShareAgentIds(db),
      cleanup: createKbShareAgentCleanup({ db, store: artifacts }),
    },
    {
      name: "usage-agents",
      listAgentIds: () => listUsageAgentIds(db),
      cleanup: createUsageAgentsCleanupHook(db),
    },
    {
      name: "public-profiles",
      listAgentIds: publicAgentPage.listLiveAgentIds,
      cleanup: publicAgentPage.retireProfile,
    },
  ];
  const agentCleanupHooks = agentCleanupSources.map((s) => s.cleanup);

  const orphanOwnerLookups = [
    findChannelOwnerByAgent(db),
    (agentId: string) => schedulesBoot.repo.findOwnerByAgent(agentId),
    findKbShareOwnerByAgent(db),
  ];
  const agentArtifactsSweeper = createAgentArtifactsSweeper({
    k8s: k8sClient,
    sources: agentCleanupSources,
    resolveOwner: async (agentId) => {
      for (const lookup of orphanOwnerLookups) {
        const owner = await lookup(agentId);
        if (owner) return owner;
      }
      return null;
    },
    batchSize: 200,
  });

  await periodicJobs.register("agent-artifacts-sweep", 30 * 60_000, () =>
    agentArtifactsSweeper.tick(),
  );

  const artifactExpirySweeper = composeArtifactExpirySweeper({
    db,
    artifacts: artifactsModule.service,
    batchSize: 200,
  });
  await periodicJobs.register("artifact-expiry-sweep", 60 * 60_000, () =>
    artifactExpirySweeper.tick(),
  );

  const prStateResolver = composePrStateResolver({
    db,
    agents: agentsRepo,
    namespace: config.namespace,
    log: (msg) => process.stderr.write(`[pr-state-resolver] ${msg}\n`),
  });
  await periodicJobs.register("skill-pr-state-resolve", 10 * 60_000, () =>
    prStateResolver.tick(),
  );
  await periodicJobs.register(
    "case-study-retention-sweep",
    24 * 60 * 60_000,
    () => caseStudies.sweeper.tick(),
  );
  periodicJobs.start();

  schedulesBoot.runner.restoreAll().catch((err) => {
    process.stderr.write(
      `[schedules] restoreAll failed: ${(err as Error).message}\n`,
    );
  });
  await periodicJobs.register("schedules-reconcile", 5 * 60_000, () =>
    schedulesBoot.runner.restoreAll(),
  );
  await periodicJobs.register(
    "schedules-once-retention",
    24 * 60 * 60 * 1000,
    () => schedulesBoot.retentionTick(),
  );

  const wakeAgentFor = async (agentId: string) => {
    await agentsRepo.wakeIfHibernated(agentId);
  };
  const harnessAgentsServiceFor = (owner: string) =>
    composeAgentsModule({
      api,
      readSlackLoopGuardDrops: (ids) => loopGuardDrops.readMany(ids),
      storageGate: composeStorageGate({ k8s: k8sClient, owner }),
      resolveSlackWorkspace,
      agentStateCache,
      namespace: config.namespace,
      agentIdleTimeoutMinutes: config.agentIdleTimeoutMinutes,
      install: agentsInstallSettings(config),
      agentDefaultLimits: {
        cpu: config.agentDefaultCpuLimit,
        memory: config.agentDefaultMemoryLimit,
      },
      owner,
      db,
      readTemplateSpec: templatesRepo.readSpec,
      presetSeeder,
      cleanupHooks: agentCleanupHooks,
      runtimeMutator: runtimeDelivery.runtimeMutator,
      contributionsProgress: contributionsProgressPort,
      onboardingChecklists,
      grantProvisioner: connectionGrantProvisioner(
        connectionsServiceFor(owner),
        harnessCatalog,
      ),
    }).agents;

  const readAgentCapabilities = (agentId: string) =>
    runtimeDelivery.agentsRuntimeRepo
      .get(agentId)
      .then((r) => r?.runtimeCapabilities ?? null);
  const readHarnessConfigSupport = async (agentId: string) =>
    harnessConfigSupportOf(await readAgentCapabilities(agentId));

  const invocationLivenessSweep = composeInvocationLivenessSweep({
    db,
    agentsFor: harnessAgentsServiceFor,
    readHarnessConfigSupport,
    runsScripts: async (agentId) => {
      const capabilities = await readAgentCapabilities(agentId);
      return capabilities == null ? null : runtimeRunsScripts(capabilities);
    },
    outputs: scriptOutputs,
    readTargetRestart: async (agentId) => {
      const agent = await agentsRepo.get(agentId);
      return agent
        ? {
            podRestarts: agent.podRestarts,
            podRestartReason: agent.podRestartReason,
          }
        : null;
    },
    hasAgent: async (agentId) => (await agentsRepo.get(agentId)) !== null,
    batchSize: 200,
    frames: delegationFrames,
  });
  const invocationPinReconciler = composeInvocationPinReconciler({
    db,
    listPinnedAgentIds: () =>
      agentsRepo.listAgentIdsWithAnnotation(INVOCATIONS_ACTIVE_KEY, "true"),
    readPin: (agentId) => agentsRepo.readInvocationPin(agentId),
    release: (agentId, version) =>
      agentsRepo.releaseInvocationPin(agentId, version),
  });
  await periodicJobs.register("invocation-pin-reconcile", 60_000, () =>
    invocationPinReconciler.tick(),
  );

  const invocationSetupFailure = createInvocationSetupFailure({
    db,
    agentsFor: harnessAgentsServiceFor,
    frames: delegationFrames,
  });
  for (const kind of workspaceMutationEventKinds)
    runtimeDelivery.registerEventOutcomeHandler(kind, async (event, input) => {
      if (input.outcome === "ok") return;
      await invocationSetupFailure(
        event.agentId,
        kind === "workspace-seed" ? "seed" : "install",
        input.detail ?? input.outcome,
      );
    });
  runtimeDelivery.registerEventOutcomeHandler(
    "harness-config",
    async (event, input) => {
      if (input.outcome === "ok") return;
      await invocationSetupFailure(
        event.agentId,
        HARNESS_CONFIG_STEP,
        input.detail ?? input.outcome,
      );
    },
  );
  runtimeDelivery.registerEventOutcomeHandler(
    "trigger",
    async (event, input) => {
      const { invocation } = event.payload as Partial<TriggerEventPayload>;
      if (input.outcome !== "failed" || !invocation) return;
      await invocationSetupFailure(
        event.agentId,
        "run",
        input.detail ?? input.outcome,
      );
    },
  );
  await periodicJobs.register("invocation-liveness-sweep", 60_000, () =>
    invocationLivenessSweep.tick(),
  );
  const subAgentOutcomes = composeSubAgentOutcomeDelivery({
    db,
    pairFields: outcomePairFields,
    bump: (agentId, events) =>
      runtimeDelivery.runtimeMutator.bump(agentId, events),
    enqueue: (agentId) =>
      runtimeDelivery.runtimeMutator.enqueueAfterCommit(agentId),
    wakeUnlessStopped: (agentId) => agentsRepo.wakeUnlessStopped(agentId),
    log: (msg) => {
      process.stderr.write(`${msg}\n`);
    },
  });
  await periodicJobs.register("sub-agent-outcome-delivery", 10_000, () =>
    subAgentOutcomes.deliver(),
  );
  await periodicJobs.register("sub-agent-outcome-wake-retry", 3_600_000, () =>
    subAgentOutcomes.retry(),
  );

  const agentSweep = createAgentSweep({
    listAgents: () => liveAgentsRepo.list(),
    agentsFor: harnessAgentsServiceFor,
  });
  await periodicJobs.register("agent-sweep", 60_000, () => agentSweep.tick());
  await periodicJobs.register("environment-expiry", 5 * 60_000, () =>
    environments.sweepExpired(),
  );

  const imageUpdate = createImageUpdate({
    listAgents: () => agentsRepo.list(),
    getAgent: (id) => liveAgentsRepo.getLive(id, undefined),
    readTemplateSpec: templatesRepo.readSpec,
    writeSpec: (id, write) =>
      liveAgentsRepo.writeAgentSpec(id, undefined, write),
    agentServiceIsIdle: (id) => agentServiceIsIdle(id, config.namespace),
    idleTimeoutMinutes: config.agentIdleTimeoutMinutes,
    log: (message) => process.stderr.write(`${message}\n`),
  });
  await periodicJobs.register("image-update", 60_000, () => imageUpdate.tick());
  await periodicJobs.retire("retired-image-migration");

  await periodicJobs.register(
    "session-directory-retention",
    7 * 24 * 60 * 60 * 1000,
    () => sessionDirectoryRetentionTick(),
  );

  const { retentionTick: attentionRetentionTick } =
    composeAttentionRetention(db);
  await periodicJobs.register("attention-retention", 24 * 60 * 60 * 1000, () =>
    attentionRetentionTick(),
  );

  const listRegisteredAgentIds = listAgentIdsByOwner(db, subPseudonymizer);
  const apiServerDeps: ApiServerDeps = {
    agentStateCache,
    config,
    api,
    db,
    outboxRepo: runtimeDelivery.outboxRepo,
    channelManager,
    identityLinkService,
    pendingSlackOAuthFlows,
    pendingTelegramOAuthFlows,
    pendingSlackInstalls,
    slackInstalls,
    resolveSlackWorkspace,
    slackInstallCallbackUrl,
    telegramBindFlows,
    slackBindFlows,
    seedSources,
    redisBus,
    spendForOwner: spend.forOwner,
    spendCeilingsForOperator: spend.ceilingsForOperator,
    userBudgetsForOperator: composeUserBudgetsAdmin({
      k8s: k8sClient,
      users: {
        subByEmail: (email) => userDirectory.resolveByEmail(email),
        emailsBySub: (subs) => userDirectory.resolveManyBySub([...subs]),
        subsMatching: (text, max) => userDirectory.searchSubs(text, max),
      },
      defaults: {
        cpu: config.defaultUserCpuBudget,
        memory: config.defaultUserMemoryBudget,
        storage: config.vmPoolStorage,
      },
    }),
    providerStatus: providerStatus.service,
    outageAlerts: outageAlerts.notices,
    approvalsRelay,
    wrapperFrameSender,
    presetSeeder,
    trustedHosts,
    agentCleanupHooks,
    environmentsFor: environments.environmentsFor,
    secretStore,
    runtimeMutator: runtimeDelivery.runtimeMutator,
    contributionsProgress: contributionsProgressPort,
    onboardingChecklists,
    getAgentCapabilities: readAgentCapabilities,
    schedulesBoot,
    mountTelemetryRoutes: (app) =>
      app.route(
        "/",
        createTelemetryRoutes({
          reader: telemetryReader,
          listLiveAgentIds: (ownerSub) =>
            liveAgentsRepo.list(ownerSub).then((list) => list.map((a) => a.id)),
          listRegisteredAgentIds,
        }),
      ),
    mountUsageRoutes: usage.mount,
    mountCaseStudiesRoutes: caseStudies.mount,
    listRegisteredAgentIds,
    metricsReader,
    telemetryReader,
    sessionDirectory,
    terms: termsService,
    isTermsAccepted,
    e2e: e2eService,
    artifacts,
    delegationFrames,
    liveEvents: liveEventsModule.liveEvents,
    k8sClient,
    agentsRepo,
    connectionsBoot,
    templatesRepo,
    harnessCatalog,
    starterKitsRepo: resolvedCatalog,
    kitUpstream,
    linkedKits,
    firePair,
    reposService,
    apiKeysModule,
    satellitesBoot,
    auth,
    jwksWarmup,
    surfaceAttribution,
    slackOauthCallbackUrl,
    addresses,
    shareHostGate,
    environmentGate,
    publicAgentPageService,
    gettingStarted,
    sidebarOrder,
    sessionPresence,
    wakeAgent: wakeAgentFor,
    artifactLibraryFor,
  };
  const onboardingChecklistFor = (owner: string) =>
    createOnboardingChecklist({
      agents: harnessAgentsServiceFor(owner),
      repo: onboardingChecklists,
      ownerSub: owner,
    });
  const harnessDeps = {
    toolApprovalsFor: (owner: string) =>
      composeToolApprovalReports(approvalsRelay, owner),
    agentSecretRequestsFor: (owner: string, agentId: string) =>
      composeAgentSecretRequests({
        ownerId: owner,
        agentId,
        db,
        uiBaseUrl: config.uiBaseUrl,
        stores: connectionsBoot.secretRequestStores,
        templates: connectionsBoot.templates,
      }),
    egressProposalsFor: (owner: string, agentId: string) =>
      composeEgressProposals({
        db,
        ruleMatcher: createEgressRuleMatchAdapter(db),
        agentId,
        ownerSub: owner,
      }),
    satellitesBoot,
    secretStore,
    spendHold,
    spendStatusFor: async (agentId: string, owner: string) =>
      spend
        .forOwner({
          ownerSub: owner,
          agentBinding: "*",
          isAgentOwnedBy: (id, ownerSub) => agentsRepo.isOwnedBy(id, ownerSub),
        })
        .status({ agentId: await payerOf(agentId) }),
    agentStateCache,
    config,
    api,
    db,
    channelManager,
    seedSources,
    runtimeHello: runtimeDelivery.hello,
    sessionDirectory,
    schedulesBoot,
    runtimeMutator: runtimeDelivery.runtimeMutator,
    runtimeProgress: contributionsProgressPort,
    artifacts,
    delegationFrames,
    k8sClient,
    agentsRepo,
    templatesRepo,
    harnessCatalog,
    firePair,
    artifactLibraryFor,
    agentsServiceFor: harnessAgentsServiceFor,
    environmentsFor: environments.environmentsFor,
    connectionsServiceFor,
    caseStudySubmissions: caseStudies.submissions,
    caseStudyInspection: caseStudies.inspection,
    carriesInspectorRole: carriesInspectorRole(db, subPseudonymizer),
    agentTelemetry: createAgentTelemetry({
      reader: metricsReader,
      spend: spend.agentSpend,
    }),
    wakeAgent: wakeAgentFor,
    readHarnessConfigSupport,
    scriptOutputs,
    sessionMessages: runtimeDelivery.sessionMessages,
    markOnboardingComplete: (agentId: string, owner: string) =>
      createOnboardingMarker({
        agents: harnessAgentsServiceFor(owner),
        markAgentOnboarded: (id, at) =>
          agentsRepo.patchAnnotation(id, ANN_STARTER_KIT_ONBOARDED, at),
      })(agentId, owner),
    kitUpdateReporter: createKitUpdateReporter({
      agentsFor: harnessAgentsServiceFor,
      marks: createKitUpdateMarks(agentsRepo),
    }),
    onboardingChecklist: {
      set: (
        agentId: string,
        owner: string,
        steps: readonly { id: string; label: string }[],
      ) => onboardingChecklistFor(owner).set(agentId, steps),
      complete: (agentId: string, owner: string, id: string) =>
        onboardingChecklistFor(owner).complete(agentId, id),
    },
  };
  const extAuthzDeps = {
    port: config.extAuthzPort,
    holdSeconds: config.approvalHoldSeconds,
    gate: extAuthzGate,
    spend: spend.ingest,
    releaseName: config.releaseName,
  };

  void telegramWorker?.resolveIdentity();
  void leaderLease.start();

  const cleanup = async (): Promise<void> => {
    publicAgentProfileSub.unsubscribe();
    attachFirstProviderSub.unsubscribe();
    usageMetrics.stop();
    kbShareAutoRefresh.unsubscribe();
    approvalsWakeSaga.unsubscribe();
    spend.extendSaga.unsubscribe();
    spend.lastKnownNameSaga.unsubscribe();
    spend.connectionLimitsSaga.unsubscribe();
    providerStatusSaga.unsubscribe();
    outageAlertsSaga.unsubscribe();
    defaultConversionSaga.unsubscribe();
    usage.stop();
    audit.stop();
    gettingStarted.stop();
    await agentStateCache.stop();
    await leaderLease.stop();
    liveEventsModule.stop();
    resourceAlerts.stop();
    await periodicJobs.close();
    channelRpc.close();
    await channelManager.stopAll();
    await runtimeDelivery.worker.close();
    await runtimeDelivery.queue.close();
    await schedulesBoot.close();
    await redisBus.close();
    turnAttendance.close();
    await chatSdkState?.disconnect().catch(() => {});
    await sharedRedis.quit().catch(() => {});
    await sql.end();
  };

  return { apiServerDeps, harnessDeps, extAuthzDeps, cleanup };
}

function loadTrustedHosts(path: string): readonly string[] {
  if (!path) return [];
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    process.stderr.write(
      `trusted-hosts: ${path}: ${err instanceof Error ? err.message : err}\n`,
    );
    return [];
  }
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}
