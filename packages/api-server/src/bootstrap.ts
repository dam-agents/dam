import { readFileSync } from "node:fs";
import { createDb, runMigrations } from "db";
import type { TriggerEventPayload } from "agent-runtime-api";
import {
  createAgentInformer,
  createApi,
  createK8sClient,
  createLeaseApi,
  podBaseUrl,
} from "./modules/agents/infrastructure/k8s.js";
import {
  AGENTS_PLURAL,
  ANN_STARTER_KIT_ONBOARDED,
  EXPERIMENT_ACTIVE_KEY,
  LABEL_OWNER,
} from "./modules/agents/infrastructure/labels.js";
import {
  composeAgentsModule,
  composePublicAgentPage,
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
  findSlackChannelsByAgent,
  deleteSlackChannelBinding,
  setSlackChannelAmbient,
  setSlackChannelDefault,
  createAgentSweep,
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
import { createFakeSlackGateway } from "./modules/channels/infrastructure/fake-slack-gateway.js";
import { createTelegramWorker } from "./modules/channels/infrastructure/telegram.js";
import {
  createChannelManager,
  channelRpcRequestSchema,
  type ChannelRpcRequest,
} from "./modules/channels/services/channel-manager.js";
import { createIdentityLinkService } from "./modules/channels/services/identity-link-service.js";
import {
  findIdentityByExternalUser,
  upsertIdentityLink,
  deleteIdentityLink,
} from "./modules/channels/infrastructure/identity-links-repository.js";
import {
  findAgentByConversation,
  bindConversation,
  listConversationsByAgent,
  unbindConversation,
  allConversationAgentIds,
  deleteConversationsByAgent,
} from "./modules/channels/infrastructure/telegram-conversations-repository.js";
import {
  createTelegramBindFlowStore,
  type TelegramOAuthPending,
} from "./modules/channels/infrastructure/telegram-flows.js";
import { createSlackBindFlowStore } from "./modules/channels/infrastructure/slack-flows.js";
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
  composeRuntimeDelivery,
  createBullConnection,
} from "./modules/runtime-delivery/index.js";
import { createHarnessConfigSnapshotWriter } from "./modules/harness-config/index.js";
import {
  composeSchedulesAtBoot,
  createSchedulesCleanupHook,
} from "./modules/schedules/index.js";
import {
  createKubernetesSecretStore,
  createSecretStoreRegistry,
} from "./modules/secret-store/index.js";
import {
  composeAttentionRetention,
  composeSessionWatcher,
  createAttentionCleanupHook,
  listAttentionAgentIds,
} from "./modules/attention/index.js";
import { composeSessionDirectory } from "./modules/session-directory/index.js";
import { composeUsageModule } from "./modules/usage/compose.js";
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
  createUnavailableAgentTelemetry,
} from "./modules/metrics/index.js";
import { composeCaseStudiesModule } from "./modules/case-studies/index.js";
import { composeAuditModule } from "./modules/audit/index.js";
import { composeLiveEventsModule } from "./modules/live-events/index.js";
import { composeE2eModule } from "./modules/e2e/compose.js";
import { composeTermsModule } from "./modules/terms/index.js";
import { loadConfig } from "./config.js";
import { configureLogger, getLogger } from "./core/logger.js";
import { reconcileUsageViewGrants } from "./modules/usage/infrastructure/usage-view-grants.js";
import { reportUsageViewGrants } from "./modules/usage/infrastructure/usage-view-grants-report.js";
import { metrics } from "@opentelemetry/api";
import { composeUsageMetricsModule } from "./modules/usage-metrics/index.js";
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
  listApiKeyAgentIds,
} from "./modules/api-keys/index.js";
import {
  composeArtifactExpirySweeper,
  composeArtifactLibraryForOwner,
  composeShareAuth,
  composeShareRenderTokens,
  composeShareViewer,
  createAgentApiPodClient,
  createByLinkHostGate,
  createContentApp,
  createShareAuthRoutes,
  createShareViewerApp,
  type ArtifactLibraryFor,
} from "./modules/artifact-library/index.js";
import { createReposRepository } from "./modules/repos/infrastructure/repos-repository.js";
import { composeArtifactsModule } from "./modules/artifacts/compose.js";
import { createTemplatesRepository } from "./modules/templates/infrastructure/templates-repository.js";
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
  createResolvedCatalogRepository,
  parseCatalogSeeds,
} from "./modules/starter-kits/index.js";
import {
  composeInvocationLivenessSweep,
  createDriverResolutionAdapter,
  createInvocationsCleanupHook,
  listInvocationAgentIds,
} from "./modules/invocations/index.js";
import {
  composeApprovalsSystem,
  createApprovalsCleanupHook,
  listPendingApprovalAgentIds,
} from "./modules/approvals/compose.js";
import { createWrapperFrameSender } from "./modules/approvals/infrastructure/wrapper-frame-sender.js";
import {
  createEgressRuleMatchAdapter,
  createEgressRulesCleanupHook,
  createL7PromotionReconcile,
  createPresetSeederAdapter,
  listEgressRuleAgentIds,
} from "./modules/egress-rules/compose.js";
import {
  composeConnectionsAtBoot,
  composeConnectionsForOwner,
  createConnectionGrantsCleanupHook,
  listConnectionGrantAgentIds,
} from "./modules/connections/compose.js";
import { createConnectionRulesSyncAdapter } from "./modules/egress-rules/compose.js";
import {
  createAgentArtifactsSweeper,
  type AgentCleanupSource,
} from "./sagas/agent-artifacts-sweeper.js";
import {
  composeExperimentInactivitySweep,
  createExperimentsCleanupHook,
  listOpenExperimentDriverIds,
  reconcileExperimentPins,
} from "./modules/experiments/index.js";
import { createPeriodicJobs } from "./core/periodic-jobs.js";
import { createRedisTtlStore } from "./core/ttl-store.js";
import { createXactLock } from "./core/xact-lock.js";
import { createRedisBus } from "./core/redis-bus.js";
import { createBusRpc } from "./core/bus-rpc.js";
import { createRedisBlobHandoff } from "./core/blob-handoff.js";
import { createLeaderLease, type LeaderRole } from "./core/leader-lease.js";
import {
  startAgentStateCache,
  createLiveAgentStateCache,
} from "./modules/agents/infrastructure/agent-state-cache.js";
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
  const agentStateCache = startAgentStateCache({
    informer: createAgentInformer(config.namespace),
    live: k8sClient,
    namespace: config.namespace,
    log: (m) => getLogger().warn(`[agents] ${m}`),
  });
  const agentsRepo = createAgentsRepository(k8sClient, agentStateCache);
  const liveAgentsRepo = createAgentsRepository(
    k8sClient,
    createLiveAgentStateCache(k8sClient),
  );
  const agentEnvRepo = createAgentEnvRepository(db);

  const templatesRepo = createTemplatesRepository(config.agentTemplatesPath);
  const resolvedCatalog = createResolvedCatalogRepository(db);
  const kitGitHosts = createGitHosts({
    host: config.githubEnterpriseHost,
    token: config.githubEnterpriseToken,
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
    refs: createGitRefResolver(kitGitHosts),
    sourceForEntry: (gitUrl, ref) =>
      createGitCatalogSource(kitGitHosts, gitUrl, ref),
    appVersion: config.appVersion,
    scanSkills: async (gitUrl, ref, subPath) =>
      (await scanPublicGithubArchive(gitUrl, subPath, ref)).map((skill) => ({
        name: skill.name,
        description: skill.description,
      })),
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
  const auth = createAuth(
    {
      issuerUrl: `${config.keycloakExternalUrl}/realms/${config.keycloakRealm}`,
      jwksUrl: `${config.keycloakUrl}/realms/${config.keycloakRealm}/protocol/openid-connect/certs`,
      audience: config.keycloakApiAudience,
      requiredRole: config.keycloakRequiredRole,
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
  const shareAuth = composeShareAuth({
    redis: sharedRedis,
    keycloak: {
      externalUrl: config.keycloakExternalUrl,
      internalUrl: config.keycloakUrl,
      realm: config.keycloakRealm,
      clientId: config.keycloakShareClientId,
    },
    shareBaseUrl: config.shareBaseUrl,
  });
  const shareHostGate = createByLinkHostGate({
    share: {
      baseUrl: config.shareBaseUrl,
      app: createShareHostApp({
        auth: createShareAuthRoutes({
          auth: shareAuth,
          brandName: config.brand.name,
          secureCookie: new URL(config.shareBaseUrl).protocol === "https:",
        }),
        viewer: createShareViewerApp({
          viewer: shareViewer,
          auth: shareAuth,
          renderTokens: shareRenderTokens,
          brandName: config.brand.name,
          uiBaseUrl: config.uiBaseUrl,
          contentBaseUrl: config.contentBaseUrl,
        }),
        kbMcp: composeKbShareServing({
          db,
          store: artifacts,
          k8s: k8sClient,
          grepDeadlineMs: config.kbShareGrepDeadlineMs,
        }),
      }),
    },
    content: {
      baseUrl: config.contentBaseUrl,
      app: createContentApp({
        viewer: shareViewer,
        renderTokens: shareRenderTokens,
        shareBaseUrl: config.shareBaseUrl,
      }),
    },
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
    resolveOwner: resolveAgentOwner,
    deliveryConcurrency: config.runtimeDeliveryConcurrency,
  });
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
        return await createAgentWorkspaceFiles(
          `http://${podBaseUrl(agentId, config.namespace)}/api/trpc`,
        ).write({
          path: `.dam/satellite-jobs/${ref.replace("#", "-")}.log`,
          bytes: Buffer.from(output, "utf8"),
          contentType: "text/plain",
        });
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
    bump: (
      agentId: string,
      events: Parameters<typeof runtimeDelivery.runtimeMutator.bump>[1],
    ) => runtimeDelivery.runtimeMutator.bump(agentId, events),
    enqueue: (agentId: string) =>
      runtimeDelivery.runtimeMutator.enqueueAfterCommit(agentId),
    wakeAgent: (agentId: string) => agentsRepo.wakeIfHibernated(agentId),
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

  const secretStores = createSecretStoreRegistry();
  secretStores.register(createKubernetesSecretStore({ k8s: k8sClient }));

  const OAUTH_FLOW_TTL_MS = 10 * 60 * 1000;
  const SLACK_INSTALL_HANDOFF_TTL_MS = 24 * 60 * 60 * 1000;
  const connectionsBoot = composeConnectionsAtBoot({
    db,
    shareBaseUrl: config.shareBaseUrl,
    secretStore: secretStores.default(),
    pendingFlowStore: createRedisTtlStore(
      sharedRedis,
      "oauth:connections",
      OAUTH_FLOW_TTL_MS,
    ),
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
      secretStore: secretStores.default(),
      runtimeMutator: runtimeDelivery.runtimeMutator,
      agentsRepo,
      connectionRulesSync: createConnectionRulesSyncAdapter(db),
      oauthCallbackUrl: `${config.uiBaseUrl}/api/oauth/callback`,
      brandName: config.brand.name,
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

  const { service: termsService, isAcceptedPort: isTermsAccepted } =
    composeTermsModule({
      db,
      version: config.terms.version,
      text: config.terms.text,
    });

  const fakeSlackGateway =
    config.e2eEnabled && !(config.slackBotToken && config.slackAppToken)
      ? createFakeSlackGateway()
      : undefined;

  const { service: e2eService } = composeE2eModule({
    namespace: config.namespace,
    slack: fakeSlackGateway,
    ...(fakeSlackGateway
      ? {
          slackInstalls: {
            record: (install) => slackInstalls.record(install),
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
    templateOf: (agentId) => {
      const agent = agentsRepo.peekCached(agentId);
      return agent
        ? { agent: "resolved", templateId: agent.templateId }
        : { agent: "unresolved" };
    },
    knownTemplates: new Set((await templatesRepo.list()).map((t) => t.id)),
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
        .map((a) => ({
          id: a.metadata!.name!,
          owner: a.metadata!.labels![LABEL_OWNER]!,
        }));
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

  const caseStudies = composeCaseStudiesModule({
    db,
    inspectorRole: config.keycloakInspectorRole ?? "",
    retentionDays: config.caseStudiesRetentionDays,
    graceDays: config.caseStudiesTombstoneGraceDays,
  });
  const metricsReader = composeMetricsReader(config);
  const telemetryReader = composeTelemetryReader(config);

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
    onAgentChanged: () => sessionWatcher.agentsChanged(),
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

  const { agents: systemAgents } = composeAgentsModule({
    cleanupHooks: [],
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
    ? createTelegramBindFlowStore({
        store: createRedisTtlStore(
          sharedRedis,
          "bind:telegram",
          OAUTH_FLOW_TTL_MS,
        ),
      })
    : undefined;
  const slackBindFlows = createSlackBindFlowStore({
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
  const slackInstalls = createSlackInstallService({
    find: findSlackInstall(db),
    upsert: upsertSlackInstall(db),
    setState: setSlackCredentialState(db),
    secrets: secretStores.default(),
    installLock: createXactLock(db),
    envBotToken: config.slackBotToken,
  });

  const chatSdkDatabaseUrl = config.databaseCaCertPath
    ? `${config.databaseUrl}${config.databaseUrl.includes("?") ? "&" : "?"}sslrootcert=${config.databaseCaCertPath}`
    : config.databaseUrl;
  const chatSdkState = config.telegramBotToken
    ? createPostgresState({ url: chatSdkDatabaseUrl, keyPrefix: "chat-sdk" })
    : undefined;

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

  const slackTokens =
    config.slackBotToken && config.slackAppToken
      ? { botToken: config.slackBotToken, appToken: config.slackAppToken }
      : null;

  const slackGatewayFactory = slackTokens
    ? () =>
        createBoltSlackGateway({
          resolveBotToken: slackInstalls.resolveBotToken,
          setOriginalWorkspace: slackInstalls.setOriginalWorkspace,
          envBotToken: slackTokens.botToken,
          appToken: slackTokens.appToken,
          commandName: `/${config.brand.short}`,
          onCredentialRejected: slackInstalls.markRejected,
        })
    : fakeSlackGateway
      ? () => fakeSlackGateway
      : undefined;

  const makeAcpClient: AcpClientFactory = (instanceName) =>
    createAcpClient({
      namespace: config.namespace,
      instanceName,
      stallProbeMs: config.acpTurnStallProbeSeconds * 1000,
    });

  const slackWorker = slackGatewayFactory
    ? createSlackWorker(
        makeAcpClient,
        slackGatewayFactory,
        () => systemAgents,
        identityLinkService,
        {
          keycloakExternalUrl: config.keycloakExternalUrl,
          keycloakUrl: config.keycloakUrl,
          keycloakRealm: config.keycloakRealm,
          keycloakClientId: config.keycloakClientId,
          callbackUrl: slackOauthCallbackUrl,
        },
        pendingSlackOAuthFlows,
        (agentId) => agentsRepo.getOwner(agentId),
        channelRegistry,
        deleteSlackChannelBinding(db),
        setSlackChannelAmbient(db),
        setSlackChannelDefault(db),
        { name: config.brand.name, short: config.brand.short },
        isTermsAccepted,
        config.uiBaseUrl,
        turnAttendance,
        (agentId) =>
          createAgentWorkspaceFiles(
            `http://${podBaseUrl(agentId, config.namespace)}/api/trpc`,
          ),
        slackInstalls.canonicalWorkspaceName,
        undefined,
        DEFAULT_SETTLE_MS,
        undefined,
        config.imgbbApiKey ? createImgbbAgentIcons(config.imgbbApiKey) : null,
      )
    : undefined;

  const resolveSlackWorkspace = createSlackWorkspaceProbe({
    listInstalledWorkspaces: async () =>
      (await listSlackInstalls(db)())
        .filter((i) => i.credentialState === "active")
        .map((i) => i.teamId),
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
            unbind: unbindConversation(db),
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
    ],
    log: (m) => getLogger().info(`[leader] ${m}`),
  });

  const trustedHosts = loadTrustedHosts(config.trustedHostsPath);
  const presetSeeder = createPresetSeederAdapter(db, trustedHosts);

  const invocationDriverResolution = createDriverResolutionAdapter(db);

  const wrapperFrameSender = createWrapperFrameSender({
    resolveWrapperUrl: (agentId) =>
      `ws://${podBaseUrl(agentId, config.namespace)}/api/acp`,
  });

  const {
    relay: approvalsRelay,
    gate: extAuthzGate,
    sweeper: deliverySweeper,
    wakeSaga: approvalsWakeSaga,
  } = composeApprovalsSystem({
    db,
    bus: redisBus,
    identityResolver: {
      resolve: async (agentId) => {
        const rootId = await invocationDriverResolution.resolveRoot(agentId);
        if (!rootId) return null;
        const r = await agentsRepo.resolveIdentity(rootId);
        return r ? { ownerSub: r.owner, agentId: r.agentId } : null;
      },
    },
    ruleMatcher: createEgressRuleMatchAdapter(db),
    attendance: turnAttendance,
    wrapperFrameSender,
    holdSeconds: config.approvalHoldSeconds,
    platformAllowedHosts: config.objectStorageAgentEndpoint
      ? [new URL(config.objectStorageAgentEndpoint).hostname]
      : [],
  });
  await periodicJobs.register("approvals-delivery-sweep", 30_000, () =>
    deliverySweeper.tick(),
  );

  const registrySecretPort = createAgentRegistrySecretPort(k8sClient);

  const schedulesBoot = composeSchedulesAtBoot({
    db,
    bullConnection,
    runtimeMutator: runtimeDelivery.runtimeMutator,
    wakeAgent: (agentId) => agentsRepo.wakeIfHibernated(agentId),
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
  });
  runtimeDelivery.registerEventOutcomeHandler(
    "trigger",
    async (event, input) => {
      const { scheduleId, precheck } =
        event.payload as Partial<TriggerEventPayload>;
      if (!scheduleId || !precheck) return;
      await schedulesBoot.runner.reportFire({
        scheduleId,
        eventId: input.eventId,
        ranPrecheck: precheck,
        outcome: input.outcome,
        ...(input.detail ? { detail: input.detail } : {}),
      });
    },
  );

  const agentApiPodClient = createAgentApiPodClient(config.namespace);
  const artifactLibraryFor: ArtifactLibraryFor = (owner, surface, opts) =>
    composeArtifactLibraryForOwner({
      db,
      artifacts,
      owner,
      surface,
      shareBaseUrl: config.shareBaseUrl,
      agentExists: opts?.agentExists,
      ensureReady: (agentId) => agentsRepo.ensureReady(agentId),
      agentApi: agentApiPodClient,
    }).artifactLibrary;
  const artifactLibraryForSystem = (owner: string) =>
    artifactLibraryFor(owner, "system");

  const agentCleanupSources: AgentCleanupSource[] = [
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
      name: "experiments",
      listAgentIds: () => listOpenExperimentDriverIds(db),
      cleanup: createExperimentsCleanupHook({
        db,
        artifactLibraryFor: artifactLibraryForSystem,
        agentsFor: (owner) => harnessAgentsServiceFor(owner),
      }),
    },
    {
      name: "invocations",
      listAgentIds: () => listInvocationAgentIds(db),
      cleanup: createInvocationsCleanupHook({
        db,
        agentsFor: (owner) => harnessAgentsServiceFor(owner),
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

  const experimentPin = {
    set: (agentId: string) =>
      agentsRepo.patchAnnotation(agentId, EXPERIMENT_ACTIVE_KEY, "true"),
    clear: (agentId: string) =>
      agentsRepo.patchAnnotation(agentId, EXPERIMENT_ACTIVE_KEY, ""),
  };
  const experimentInactivityMs = config.experimentInactivitySeconds * 1000;
  const experimentInactivitySweep = composeExperimentInactivitySweep({
    db,
    inactivityMs: experimentInactivityMs,
    batchSize: 200,
    pin: experimentPin,
    artifactLibraryFor: artifactLibraryForSystem,
    agentsFor: (owner) => harnessAgentsServiceFor(owner),
  });
  await periodicJobs.register(
    "experiment-inactivity-sweep",
    Math.min(experimentInactivityMs, 5 * 60_000),
    () => experimentInactivitySweep.tick(),
  );

  void reconcileExperimentPins({
    db,
    listPinnedAgentIds: () =>
      agentsRepo.listAgentIdsWithAnnotation(EXPERIMENT_ACTIVE_KEY, "true"),
    pin: experimentPin,
  }).then(
    ({ set, cleared }) => {
      if (set > 0 || cleared > 0) {
        process.stderr.write(
          `[experiments] pin reconciliation: set ${set}, cleared ${cleared}\n`,
        );
      }
    },
    (err) => {
      process.stderr.write(`[experiments] pin reconciliation failed: ${err}\n`);
    },
  );

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

  const wakeAgentFor = async (agentId: string) => {
    await agentsRepo.wakeIfHibernated(agentId);
  };
  const harnessAgentsServiceFor = (owner: string) =>
    composeAgentsModule({
      api,
      resolveSlackWorkspace,
      agentStateCache,
      namespace: config.namespace,
      agentIdleTimeoutMinutes: config.agentIdleTimeoutMinutes,
      virtualizationEnabled: config.virtualizationEnabled,
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
      ),
    }).agents;

  const invocationLivenessSweep = composeInvocationLivenessSweep({
    db,
    agentsFor: harnessAgentsServiceFor,
    readTargetRestart: async (agentId) => {
      const agent = await agentsRepo.get(agentId);
      return agent
        ? {
            podRestarts: agent.podRestarts,
            podRestartReason: agent.podRestartReason,
          }
        : null;
    },
    batchSize: 200,
  });
  await periodicJobs.register("invocation-liveness-sweep", 60_000, () =>
    invocationLivenessSweep.tick(),
  );

  const agentSweep = createAgentSweep({
    listAgents: () => liveAgentsRepo.list(),
    agentsFor: harnessAgentsServiceFor,
  });
  await periodicJobs.register("agent-sweep", 60_000, () => agentSweep.tick());

  const { sessionDirectory, retentionTick: sessionDirectoryRetentionTick } =
    composeSessionDirectory(db);
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
    approvalsRelay,
    wrapperFrameSender,
    presetSeeder,
    trustedHosts,
    agentCleanupHooks,
    secretStores,
    runtimeMutator: runtimeDelivery.runtimeMutator,
    contributionsProgress: contributionsProgressPort,
    onboardingChecklists,
    getAgentCapabilities: (agentId) =>
      runtimeDelivery.agentsRuntimeRepo
        .get(agentId)
        .then((r) => r?.runtimeCapabilities ?? null),
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
    liveEvents: liveEventsModule.liveEvents,
    k8sClient,
    agentsRepo,
    connectionsBoot,
    templatesRepo,
    starterKitsRepo: resolvedCatalog,
    reposService,
    apiKeysModule,
    satellitesBoot,
    auth,
    jwksWarmup,
    surfaceAttribution,
    slackOauthCallbackUrl,
    shareHostGate,
    publicAgentPageService,
    sessionPresence,
    wakeAgent: wakeAgentFor,
    experimentPin,
    artifactLibraryFor,
  };
  const onboardingChecklistFor = (owner: string) =>
    createOnboardingChecklist({
      agents: harnessAgentsServiceFor(owner),
      repo: onboardingChecklists,
      ownerSub: owner,
    });
  const harnessDeps = {
    satellitesBoot,
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
    k8sClient,
    agentsRepo,
    templatesRepo,
    artifactLibraryFor,
    experimentPin,
    agentsServiceFor: harnessAgentsServiceFor,
    connectionsServiceFor,
    caseStudySubmissions: caseStudies.submissions,
    caseStudyInspection: caseStudies.inspection,
    carriesInspectorRole: carriesInspectorRole(db, subPseudonymizer),
    agentTelemetry: metricsReader
      ? createAgentTelemetry({ reader: metricsReader })
      : createUnavailableAgentTelemetry(),
    wakeAgent: wakeAgentFor,
    markOnboardingComplete: (agentId: string, owner: string) =>
      createOnboardingMarker({
        agents: harnessAgentsServiceFor(owner),
        markAgentOnboarded: (id, at) =>
          agentsRepo.patchAnnotation(id, ANN_STARTER_KIT_ONBOARDED, at),
      })(agentId, owner),
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
    releaseName: config.releaseName,
  };

  void telegramWorker?.resolveIdentity();
  void leaderLease.start();

  const cleanup = async (): Promise<void> => {
    publicAgentProfileSub.unsubscribe();
    usageMetrics.stop();
    kbShareAutoRefresh.unsubscribe();
    approvalsWakeSaga.unsubscribe();
    usage.stop();
    audit.stop();
    await agentStateCache.stop();
    await leaderLease.stop();
    liveEventsModule.stop();
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
