import { readFileSync } from "node:fs";
import { createDb, runMigrations } from "db";
import {
  AGENTS_PLURAL,
  LABEL_OWNER,
} from "./modules/agents/infrastructure/labels.js";
import {
  composeAgentsModule,
  composePublicAgentPage,
  createAgentsRepository,
  createAgentEnvRepository,
  createAgentRegistryAuthPort,
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
import { createPostgresState } from "@chat-adapter/state-pg";
import {
  createSlackWorker,
  type SlackOAuthPending,
  type ChannelRegistry,
} from "./modules/channels/infrastructure/slack.js";
import { createAgentWorkspaceFiles } from "./modules/channels/infrastructure/agent-workspace-files.js";
import { DEFAULT_SETTLE_MS } from "./modules/channels/domain/turn-coalescing.js";
import { createBoltSlackGateway } from "./modules/channels/infrastructure/bolt-slack-gateway.js";
import { createFakeSlackGateway } from "./modules/channels/infrastructure/fake-slack-gateway.js";
import { createTelegramWorker } from "./modules/channels/infrastructure/telegram.js";
import {
  createChannelManager,
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
  createFileSecretStore,
  createSecretStoreRegistry,
} from "./modules/secret-store/index.js";
import { composeSessionDirectory } from "./modules/session-directory/index.js";
import { composeUsageModule } from "./modules/usage/compose.js";
import {
  createUsageAgentsCleanupHook,
  listUsageAgentIds,
} from "./modules/usage/index.js";
import { listAgentIdsByOwner } from "./modules/usage/infrastructure/agents-postgres-repository.js";
import { carriesInspectorRole } from "./modules/usage/infrastructure/actor-role-flags.js";
import {
  composeMetricsReader,
  createAgentUsageSummary,
  createUnavailableAgentUsageSummary,
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
import { createTurnMetrics } from "./core/turn-metrics.js";
import { startTurnMetricsSaga } from "./sagas/turn-metrics.js";
import { formatError } from "./core/format-error.js";
import type { ApiServerDeps } from "./apps/api-server/deps.js";
import {
  createAuth,
  startJwksWarmup,
  type SurfaceAttribution,
} from "./apps/api-server/admission/index.js";
import { createSessionPresence } from "./apps/api-server/agent-proxies/index.js";
import {
  composeApiKeysModule,
  createApiKeysCleanupHook,
  listApiKeyAgentIds,
} from "./modules/api-keys/index.js";
import {
  composeShareAuth,
  composeShareRenderTokens,
  composeShareViewer,
  createByLinkHostGate,
  createContentApp,
  createShareAuthRoutes,
  createShareViewerApp,
} from "./modules/artifact-library/index.js";
import { createReposRepository } from "./modules/repos/infrastructure/repos-repository.js";
import { composeArtifactsModule } from "./modules/artifacts/compose.js";
import { createTemplatesRepository } from "./modules/templates/infrastructure/templates-repository.js";
import { composeTemplatesModule } from "./modules/templates/compose.js";
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
import { EXPERIMENT_ACTIVE_KEY } from "./modules/agents/infrastructure/labels.js";
import {
  composeArtifactExpirySweeper,
  composeArtifactLibraryForOwner,
} from "./modules/artifact-library/index.js";
import { loadTrustedHosts } from "./bootstrap/trusted-hosts.js";
import { createPeriodicJobs } from "./core/periodic-jobs.js";
import { createRedisTtlStore } from "./core/ttl-store.js";
import { createRedisBus } from "./core/redis-bus.js";
import { createAgentStore } from "./modules/agents/infrastructure/agent-store.js";
import { startSandboxAddresses } from "./modules/agents/infrastructure/sandbox-addresses.js";
import { createTurnAttendance } from "./core/turn-attendance.js";
import { createSubPseudonymizer } from "./core/sub-pseudonymizer.js";

export async function bootstrap() {
  const config = loadConfig();
  configureLogger({
    level: config.logLevel,
    base: { appVersion: config.appVersion },
  });
  getLogger().info("api-server starting");

  const dbTls = {
    ca: config.databaseCaCertPath
      ? readFileSync(config.databaseCaCertPath, "utf8")
      : undefined,
  };
  await runMigrations(config.databaseUrl, config.migrationsPath, dbTls);
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
  await artifactsModule.ensureReady();
  const artifacts = artifactsModule.service;

  if (!config.redisUrl)
    throw new Error("REDIS_URL is required (Redis is a platform primitive)");
  const bullConnection = createBullConnection(
    config.redisUrl,
    config.redisPassword ?? undefined,
  );
  const redisBus = createRedisBus(config.redisUrl, {
    password: config.redisPassword ?? undefined,
  });
  const sharedRedis = createBullConnection(
    config.redisUrl,
    config.redisPassword ?? undefined,
  ) as import("ioredis").Redis;

  const turnAttendance = createTurnAttendance(sharedRedis);
  connectScanCacheBus(redisBus);

  const periodicJobs = createPeriodicJobs({
    connection: bullConnection,
    log: (msg) => process.stderr.write(`[periodic-jobs] ${msg}\n`),
  });

  const agentStore = createAgentStore(db);
  const sandboxAddresses = await startSandboxAddresses(
    agentStore,
    config.sandboxPort,
  );
  const agentsRepo = createAgentsRepository(agentStore);
  const agentEnvRepo = createAgentEnvRepository(db);

  const templatesRepo = createTemplatesRepository(config.agentTemplatesPath);
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
      uiClientId: config.keycloakClientId,
      cliClientId: config.keycloakCliClientId,
      coreRole: config.keycloakInspectorRole,
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
          agentStore,
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
  const sessionPresence = createSessionPresence(agentsRepo, sharedRedis);
  await periodicJobs.register("session-presence-reconcile", 60_000, () =>
    sessionPresence.reconcile(),
  );

  const l7PromotionReconcile = createL7PromotionReconcile(db, agentStore, (m) =>
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
    sandboxAddresses,
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
  await periodicJobs.register("runtime-outbox-sweep", 60_000, () =>
    runtimeDelivery.sweep.tick(),
  );
  const contributionsProgressPort = {
    status: runtimeDelivery.contributionsStatus,
    statusMany: runtimeDelivery.contributionsStatusMany,
    progress: runtimeDelivery.contributionsProgress,
  };
  const subPseudonymizer = createSubPseudonymizer(config.activityHmacKey);

  const secretStores = createSecretStoreRegistry();
  secretStores.register(
    createFileSecretStore({ root: config.secretStoreRoot }),
  );

  const OAUTH_FLOW_TTL_MS = 10 * 60 * 1000;
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
    addresses: sandboxAddresses,
    slack: fakeSlackGateway,
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
    sandboxAddresses,
  });
  const turnMetricsSub = startTurnMetricsSaga(
    createTurnMetrics(metrics.getMeter("platform-apiserver")),
  );
  const seedSources = parseSeedSources(config.skillSourcesSeed);

  const usage = composeUsageModule({
    db,
    subPseudonymizer,
    activityTrackingEnabled: config.activityTrackingEnabled,
    inspectorRole: config.keycloakInspectorRole ?? "",
    listAgentIdentities: async () =>
      (await agentStore.list()).map((a) => ({ id: a.id, owner: a.owner })),
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

  const liveEventsModule = composeLiveEventsModule({
    bus: redisBus,
    log: (m) => getLogger().warn(`[live-events] ${m}`),
    agentStore,
    sandboxAddresses,
    agentsRepo,
    runtimeFeaturesFor: (ids) => runtimeDelivery.runtimeFeaturesMany(ids),
  });
  liveEventsModule.start();
  const { agents: systemAgents } = composeAgentsModule({
    cleanupHooks: [],
    agentStore,
    sandboxAddresses,
    registryAuthRoot: config.registryAuthRoot,
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
  const telegramOauthCallbackUrl = `${config.uiBaseUrl}/api/telegram/oauth/callback`;

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
          botToken: slackTokens.botToken,
          appToken: slackTokens.appToken,
          commandName: `/${config.brand.short}`,
        })
    : fakeSlackGateway
      ? () => fakeSlackGateway
      : undefined;

  const acpTurnCeilingMs = config.acpTurnCeilingSeconds * 1000;
  const makeAcpClient: AcpClientFactory = (instanceName) =>
    createAcpClient({
      addresses: sandboxAddresses,
      instanceName,
      turnCeilingMs: acpTurnCeilingMs,
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
            `http://${sandboxAddresses.baseUrl(agentId)}/api/trpc`,
          ),
        undefined,
        DEFAULT_SETTLE_MS,
      )
    : undefined;

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
          brandShort: config.brand.short,
          brandName: config.brand.name,
          attendance: turnAttendance,
          settleMs: DEFAULT_SETTLE_MS,
        })
      : undefined;

  // One node, one process: every role that admits a single holder install-wide
  // is held here by construction, so there is no election to win first.
  const channelManager = createChannelManager({ slackWorker, telegramWorker });

  const trustedHosts = loadTrustedHosts(config.trustedHostsPath);
  const presetSeeder = createPresetSeederAdapter(db, trustedHosts);

  const invocationDriverResolution = createDriverResolutionAdapter(db);

  const wrapperFrameSender = createWrapperFrameSender({
    resolveWrapperUrl: (agentId) =>
      `ws://${sandboxAddresses.baseUrl(agentId)}/api/acp`,
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
    ruleMatcher: {
      match: async (agentId, host, method, path) => {
        const matched = await createEgressRuleMatchAdapter(db).match(
          agentId,
          host,
          method,
          path,
        );
        return matched ? { verdict: matched.verdict } : null;
      },
    },
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

  const registryAuthPort = createAgentRegistryAuthPort(config.registryAuthRoot);

  const schedulesBoot = composeSchedulesAtBoot({
    db,
    bullConnection,
    runtimeMutator: runtimeDelivery.runtimeMutator,
    wakeAgent: async (agentId) => {
      await agentsRepo.wakeIfHibernated(agentId);
    },
  });
  const artifactLibraryForSystem = (owner: string) =>
    composeArtifactLibraryForOwner({
      db,
      artifacts,
      owner,
      surface: "system",
      shareBaseUrl: config.shareBaseUrl,
    }).artifactLibrary;

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
      listAgentIds: () => registryAuthPort.listAgentIds(),
      cleanup: (agentId: string) => registryAuthPort.delete(agentId),
    },
    {
      name: "connection-grants",
      listAgentIds: () => listConnectionGrantAgentIds(db),
      cleanup: createConnectionGrantsCleanupHook(db),
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
    agentStore,
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
    sandboxAddresses,
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

  const { readSpec: harnessReadTemplateSpec } =
    composeTemplatesModule(templatesRepo);
  const wakeAgentFor = async (agentId: string) => {
    await agentsRepo.wakeIfHibernated(agentId);
  };
  const harnessAgentsServiceFor = (owner: string) => {
    const connections = connectionsServiceFor(owner);
    return composeAgentsModule({
      agentStore,
      sandboxAddresses,
      registryAuthRoot: config.registryAuthRoot,
      agentIdleTimeoutMinutes: config.agentIdleTimeoutMinutes,
      agentDefaultLimits: {
        cpu: config.agentDefaultCpuLimit,
        memory: config.agentDefaultMemoryLimit,
      },
      owner,
      db,
      readTemplateSpec: harnessReadTemplateSpec,
      presetSeeder,
      cleanupHooks: agentCleanupHooks,
      runtimeMutator: runtimeDelivery.runtimeMutator,
      contributionsProgress: contributionsProgressPort,
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
    }).agents;
  };

  const invocationLivenessSweep = composeInvocationLivenessSweep({
    db,
    agentsFor: harnessAgentsServiceFor,
    readTargetRestart: async (agentId) => {
      const agent = await agentsRepo.get(agentId);
      return agent
        ? {
            sandboxRestarts: agent.sandboxRestarts,
            sandboxRestartReason: agent.sandboxRestartReason,
          }
        : null;
    },
    batchSize: 200,
  });
  await periodicJobs.register("invocation-liveness-sweep", 60_000, () =>
    invocationLivenessSweep.tick(),
  );

  const agentSweep = createAgentSweep({
    listAgents: () => agentsRepo.list(),
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

  const apiServerDeps: ApiServerDeps = {
    agentStore,
    sandboxAddresses,
    periodicJobs,
    sharedRedis,
    config,
    db,
    channelManager,
    identityLinkService,
    pendingSlackOAuthFlows,
    pendingTelegramOAuthFlows,
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
    getAgentCapabilities: (agentId) =>
      runtimeDelivery.agentsRuntimeRepo
        .get(agentId)
        .then((r) => r?.runtimeCapabilities ?? null),
    schedulesBoot,
    mountUsageRoutes: usage.mount,
    mountCaseStudiesRoutes: caseStudies.mount,
    listRegisteredAgentIds: listAgentIdsByOwner(db, subPseudonymizer),
    metricsReader,
    sessionDirectory,
    terms: termsService,
    isTermsAccepted,
    e2e: e2eService,
    artifacts,
    liveEvents: liveEventsModule.liveEvents,
    podSessions: liveEventsModule.podSessions,
    agentsRepo,
    connectionsBoot,
    templatesRepo,
    reposService,
    userDirectory,
    apiKeysModule,
    auth,
    jwksWarmup,
    surfaceAttribution,
    slackOauthCallbackUrl,
    shareHostGate,
    publicAgentPageService,
    sessionPresence,
  };
  const harnessDeps = {
    agentStore,
    sandboxAddresses,
    config,
    db,
    channelManager,
    seedSources,
    runtimeHello: runtimeDelivery.hello,
    sessionDirectory,
    schedulesBoot,
    runtimeMutator: runtimeDelivery.runtimeMutator,
    runtimeProgress: contributionsProgressPort,
    artifacts,
    agentsServiceFor: harnessAgentsServiceFor,
    connectionsServiceFor,
    caseStudySubmissions: caseStudies.submissions,
    caseStudyInspection: caseStudies.inspection,
    carriesInspectorRole: carriesInspectorRole(db, subPseudonymizer),
    usageSummary: metricsReader
      ? createAgentUsageSummary({ reader: metricsReader })
      : createUnavailableAgentUsageSummary(),
    wakeAgent: wakeAgentFor,
  };
  const extAuthzDeps = {
    port: config.extAuthzPort,
    holdSeconds: config.approvalHoldSeconds,
    gate: extAuthzGate,
    releaseName: config.releaseName,
  };

  void telegramWorker?.resolveIdentity();
  liveEventsModule.startAgentWatch();
  void listChannelsByOwner(db, "")().then((channelsByInstance) =>
    channelManager.bootstrap(channelsByInstance),
  );

  const cleanup = async (): Promise<void> => {
    publicAgentProfileSub.unsubscribe();
    turnMetricsSub.unsubscribe();
    kbShareAutoRefresh.unsubscribe();
    approvalsWakeSaga.unsubscribe();
    usage.stop();
    audit.stop();
    sandboxAddresses.stop();
    liveEventsModule.stopAgentWatch();
    liveEventsModule.stop();
    await periodicJobs.close();
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
