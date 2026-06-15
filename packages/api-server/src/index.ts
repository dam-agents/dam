import { readFileSync } from "node:fs";
import { createDb, runMigrations } from "db";
import { createApi } from "./modules/agents/infrastructure/k8s.js";
import {
  AGENTS_PLURAL,
  LABEL_OWNER,
} from "./modules/agents/infrastructure/labels.js";
import {
  composeAgentsModule,
  createAgentsRepository,
  createAgentRegistrySecretPort,
  createKeycloakUserDirectory,
  startChannelSecretCleanupSaga,
  startChannelCleanupSaga,
  deleteChannelsByAgent,
  listChannelsByOwner,
  findBySlackChannelId,
  findSlackChannelByAgent,
} from "./modules/agents/index.js";
import {
  createAgentSkillsRepository,
  parseSeedSources,
  startSkillsCleanupSaga,
} from "./modules/skills/index.js";
import { createK8sClient } from "./modules/agents/infrastructure/k8s.js";
import { stripStaleModelPins } from "./modules/secrets/infrastructure/strip-stale-model-pins.js";
import { createPostgresState } from "@chat-adapter/state-pg";
import {
  createSlackWorker,
  type SlackOAuthPending,
  type ChannelRegistry,
} from "./modules/channels/infrastructure/slack.js";
import { createBoltSlackGateway } from "./modules/channels/infrastructure/bolt-slack-gateway.js";
import {
  createTelegramWorker,
  type TelegramOAuthPending,
} from "./modules/channels/infrastructure/telegram.js";
import { createChannelManager } from "./modules/channels/services/channel-manager.js";
import { createChannelSecretStore } from "./modules/channels/infrastructure/channel-secret-store.js";
import { createIdentityLinkService } from "./modules/channels/services/identity-link-service.js";
import {
  findIdentityByExternalUser,
  upsertIdentityLink,
  deleteIdentityLink,
} from "./modules/channels/infrastructure/identity-links-repository.js";
import {
  isThreadAuthorized,
  authorizeThread,
  revokeThread,
  listAuthorizedThreads,
  deleteThreadsByAgent,
  getAuthorizedBy,
} from "./modules/channels/infrastructure/telegram-threads-repository.js";
import {
  composeRuntimeDelivery,
  createBullConnection,
} from "./modules/runtime-delivery/index.js";
import { composeSchedulesAtBoot } from "./modules/schedules/index.js";
import { createSecretEnvSource } from "./modules/secrets/services/secret-env-source.js";
import {
  createKubernetesSecretStore,
  createSecretStoreRegistry,
} from "./modules/secret-store/index.js";
import {
  composeForksModule,
  startOnForeignReplySaga,
  startOnChannelTurnRelayedSaga,
} from "./modules/forks/index.js";
import { composeUsageModule } from "./modules/usage/compose.js";
import { composeAuditModule } from "./modules/audit/index.js";
import { createK8sForkOrchestrator } from "./modules/forks/infrastructure/k8s-fork-orchestrator.js";
import { composeE2eModule } from "./modules/e2e/compose.js";
import { composeTermsModule } from "./modules/terms/index.js";
import { loadConfig } from "./config.js";
import { configureLogger, getLogger } from "./core/logger.js";
import { startApiServerApp } from "./apps/api-server/app.js";
import { startHarnessApiServerApp } from "./apps/harness-api-server/app.js";
import { startExtAuthzGrpcApp } from "./apps/ext-authz/grpc.js";
import {
  composeApprovalsSystem,
  createApprovalsCleanupHook,
  listPendingApprovalAgentIds,
} from "./modules/approvals/compose.js";
import { createWrapperFrameSender } from "./modules/approvals/infrastructure/wrapper-frame-sender.js";
import {
  createEgressRuleMatchAdapter,
  createEgressRulesCleanupHook,
  createPresetSeederAdapter,
  listEgressRuleAgentIds,
} from "./modules/egress-rules/compose.js";
import { createAgentArtifactsSweeper } from "./sagas/agent-artifacts-sweeper.js";
import { createK8sClient as createAgentsK8sClient } from "./modules/agents/infrastructure/k8s.js";
import { loadTrustedHosts } from "./bootstrap/trusted-hosts.js";
import { createRedisBus } from "./core/redis-bus.js";
import { createSubPseudonymizer } from "./core/sub-pseudonymizer.js";
import { podBaseUrl } from "./modules/agents/infrastructure/k8s.js";

const config = loadConfig();
configureLogger({
  level: config.logLevel,
  base: { appVersion: config.appVersion },
});
getLogger().info("api-server starting");

const { api, customObjects } = createApi(config.namespace);
const dbTls = {
  ca: config.databaseCaCertPath
    ? readFileSync(config.databaseCaCertPath, "utf8")
    : undefined,
};
await runMigrations(config.databaseUrl, config.migrationsPath, dbTls);
const { db, sql } = createDb(config.databaseUrl, dbTls);

if (!config.redisUrl)
  throw new Error(
    "REDIS_URL is required (Redis is a platform primitive — see ADR-036)",
  );
const bullConnection = createBullConnection(
  config.redisUrl,
  config.redisPassword ?? undefined,
);
const redisBus = createRedisBus(config.redisUrl, {
  password: config.redisPassword ?? undefined,
});

const k8sClient = createK8sClient(api, config.namespace);
const agentsRepo = createAgentsRepository(k8sClient);

const runtimeDelivery = composeRuntimeDelivery({
  db,
  namespace: config.namespace,
  bullConnection,
  // The apply worker only dispatches to a ready agent (the controller's CRD
  // Ready condition); otherwise it defers and the sweep retries once it's live.
  agentRunningPort: {
    isRunning: (agentId) => agentsRepo.isReady(agentId),
  },
  harnessServerUrl: config.harnessServerUrl,
  secretEnv: createSecretEnvSource({ k8sClient }),
});
runtimeDelivery.sweep.start();
const contributionsSettledPort = {
  status: runtimeDelivery.contributionsStatus,
  statusMany: runtimeDelivery.contributionsStatusMany,
};
const channelSecretStore = createChannelSecretStore(k8sClient);
const subPseudonymizer = createSubPseudonymizer(config.activityHmacKey);

const secretStores = createSecretStoreRegistry();
secretStores.register(createKubernetesSecretStore({ k8s: k8sClient }));

const { service: termsService, isAcceptedPort: isTermsAccepted } =
  composeTermsModule({
    db,
    version: config.terms.version,
    text: config.terms.text,
  });

const { service: e2eService } = composeE2eModule({
  namespace: config.namespace,
});

const channelSecretCleanupSub =
  startChannelSecretCleanupSaga(channelSecretStore);
const channelCleanupSub = startChannelCleanupSaga(
  deleteChannelsByAgent(db),
  deleteThreadsByAgent(db),
);
const skillsCleanupSub = startSkillsCleanupSaga((agentId) =>
  createAgentSkillsRepository(db).deleteByAgent(agentId),
);
const seedSources = parseSeedSources(config.skillSourcesSeed);

const { forks } = composeForksModule({
  orchestrator: createK8sForkOrchestrator({
    customObjects,
    namespace: config.namespace,
  }),
});

const onForeignReplySub = startOnForeignReplySaga(forks);
const onChannelTurnRelayedSub = startOnChannelTurnRelayedSaga(forks);
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

// Security audit trail (bus-driven half). Denials and call-site-only
// mutations log directly at their sites; this covers the actor-bearing
// success/observation events on the domain bus.
const audit = composeAuditModule();
audit.start();

const userDirectory = createKeycloakUserDirectory({
  keycloakUrl: config.keycloakUrl,
  keycloakRealm: config.keycloakRealm,
  clientId: config.keycloakApiClientId,
  clientSecret: config.keycloakApiClientSecret,
});

const { agents: systemAgents } = composeAgentsModule({
  api,
  namespace: config.namespace,
  owner: undefined,
  db,
  userDirectory,
  channelSecretStore,
  readTemplateSpec: async () => null,
  runtimeMutator: runtimeDelivery.runtimeMutator,
  contributionsSettled: contributionsSettledPort,
});

const identityLinkService = createIdentityLinkService({
  findByExternalUser: findIdentityByExternalUser(db),
  upsert: upsertIdentityLink(db),
  delete: deleteIdentityLink(db),
});

const pendingSlackOAuthFlows = new Map<string, SlackOAuthPending>();
const pendingTelegramOAuthFlows = new Map<string, TelegramOAuthPending>();

const slackOauthCallbackUrl =
  config.slackOauthCallbackUrl ??
  `${config.uiBaseUrl}/api/slack/oauth/callback`;
const telegramOauthCallbackUrl = `${config.uiBaseUrl}/api/telegram/oauth/callback`;

// The chat-sdk state pool uses node-postgres (`pg`), which — unlike postgres-js
// — reads a CA file from `sslrootcert` in the connection string. Append it so
// the pool verifies against the same scoped CA; trust stays on this connection.
const chatSdkDatabaseUrl = config.databaseCaCertPath
  ? `${config.databaseUrl}${config.databaseUrl.includes("?") ? "&" : "?"}sslrootcert=${config.databaseCaCertPath}`
  : config.databaseUrl;
const chatSdkState = config.telegramEnabled
  ? createPostgresState({ url: chatSdkDatabaseUrl, keyPrefix: "chat-sdk" })
  : undefined;

const channelRegistry: ChannelRegistry = {
  resolveInstanceBySlackChannel: async (slackChannelId) =>
    (await findBySlackChannelId(db)(slackChannelId))?.agentId ?? null,
  resolveSlackChannelByInstance: findSlackChannelByAgent(db),
};

const slackTokens =
  config.slackBotToken && config.slackAppToken
    ? { botToken: config.slackBotToken, appToken: config.slackAppToken }
    : null;

const slackWorker = slackTokens
  ? createSlackWorker(
      config.namespace,
      () =>
        createBoltSlackGateway({
          botToken: slackTokens.botToken,
          appToken: slackTokens.appToken,
          commandName: `/${config.brand.short}`,
        }),
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
      config.brand.short,
      isTermsAccepted,
      config.uiBaseUrl,
    )
  : undefined;

const telegramWorker =
  config.telegramEnabled && chatSdkState
    ? createTelegramWorker(
        config.namespace,
        chatSdkState,
        () => systemAgents,
        {
          isAuthorized: isThreadAuthorized(db),
          authorize: authorizeThread(db),
          list: listAuthorizedThreads(db),
          revoke: revokeThread(db),
          getAuthorizedBy: getAuthorizedBy(db),
        },
        {
          keycloakExternalUrl: config.keycloakExternalUrl,
          keycloakUrl: config.keycloakUrl,
          keycloakRealm: config.keycloakRealm,
          keycloakClientId: config.keycloakClientId,
          callbackUrl: telegramOauthCallbackUrl,
        },
        pendingTelegramOAuthFlows,
        isTermsAccepted,
        config.uiBaseUrl,
      )
    : undefined;

const channelManager = createChannelManager({
  slackWorker,
  telegramWorker,
  channelSecretStore,
});

// Seed list for the `trusted` egress preset (ADR-035).
// Read once at boot; the helm ConfigMap is the operator-editable source.
const trustedHosts = loadTrustedHosts(config.trustedHostsPath);
const presetSeeder = createPresetSeederAdapter(db, trustedHosts);

const wrapperFrameSender = createWrapperFrameSender({
  resolveWrapperUrl: (agentId) =>
    `ws://${podBaseUrl(agentId, config.namespace)}/api/acp`,
});

// System-level approvals composition — bound to the bus + cross-module
// ports for instance identity (agents), rule matching (egress-rules), and
// wrapper-frame delivery. Relay, gate, and sweeper are long-lived and
// shared across all owners.
const {
  relay: approvalsRelay,
  gate: extAuthzGate,
  sweeper: deliverySweeper,
} = composeApprovalsSystem({
  db,
  bus: redisBus,
  identityResolver: {
    resolve: async (agentId) => {
      const r = await agentsRepo.resolveIdentity(agentId);
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
  wrapperFrameSender,
  holdSeconds: config.approvalHoldSeconds,
});
deliverySweeper.start();

// Per-agent cleanup hooks fired after a successful K8s delete. Each
// module's adapter clears its own table; failures log + continue. The
// orphan-sweeper saga catches anything missed (replica died mid-delete,
// hook threw, etc.).
const agentsCleanupK8s = createAgentsK8sClient(api, config.namespace);
const registrySecretPort = createAgentRegistrySecretPort(agentsCleanupK8s);

const agentCleanupHooks = [
  createEgressRulesCleanupHook(db),
  createApprovalsCleanupHook(db),
  (agentId: string) => registrySecretPort.delete(agentId),
];

// Cross-store orphan reaper. Lists live agent ConfigMaps, finds DB rows
// keyed by an agent_id no longer in the live set, and runs each module's
// cleanup. Runs on every replica — DELETEs are idempotent, the random
// initial-delay jitter spreads scans out.
const agentArtifactsSweeper = createAgentArtifactsSweeper({
  k8s: agentsCleanupK8s,
  sources: [
    {
      name: "egress-rules",
      listAgentIds: () => listEgressRuleAgentIds(db),
      cleanup: agentCleanupHooks[0]!,
    },
    {
      name: "pending-approvals",
      listAgentIds: () => listPendingApprovalAgentIds(db),
      cleanup: agentCleanupHooks[1]!,
    },
    {
      name: "registry-pull-secrets",
      listAgentIds: () => registrySecretPort.listAgentIds(),
      cleanup: agentCleanupHooks[2]!,
    },
  ],
  intervalMs: 30 * 60_000,
  batchSize: 200,
});
agentArtifactsSweeper.start();

const schedulesBoot = composeSchedulesAtBoot({
  db,
  bullConnection,
  runtimeMutator: runtimeDelivery.runtimeMutator,
  wakeAgent: async (agentId) => {
    await agentsRepo.wakeIfHibernated(agentId);
  },
});
schedulesBoot.runner.restoreAll().catch((err) => {
  process.stderr.write(
    `[schedules] restoreAll failed: ${(err as Error).message}\n`,
  );
});

try {
  const cleared = await agentsRepo.clearActiveSessions();
  if (cleared)
    process.stderr.write(
      `[boot] cleared ${cleared} stale active-session pin(s)\n`,
    );
} catch (err) {
  process.stderr.write(
    `[boot] clearActiveSessions failed: ${(err as Error).message}\n`,
  );
}

stripStaleModelPins(k8sClient)
  .then((n) => {
    if (n)
      process.stderr.write(
        `[boot] stripped stale model pins from ${n} provider secret(s)\n`,
      );
  })
  .catch((err) =>
    process.stderr.write(
      `[boot] stale-model-pin sweep failed: ${(err as Error).message}\n`,
    ),
  );

const { server: apiServer } = startApiServerApp({
  config,
  api,
  db,
  channelManager,
  channelSecretStore,
  identityLinkService,
  pendingSlackOAuthFlows,
  pendingTelegramOAuthFlows,
  seedSources,
  redisBus,
  approvalsRelay,
  wrapperFrameSender,
  presetSeeder,
  trustedHosts,
  agentCleanupHooks,
  secretStores,
  runtimeMutator: runtimeDelivery.runtimeMutator,
  contributionsSettled: contributionsSettledPort,
  schedulesBoot,
  mountUsageRoutes: usage.mount,
  terms: termsService,
  isTermsAccepted,
  e2e: e2eService,
});

const { server: harnessApiServer } = startHarnessApiServerApp({
  config,
  api,
  db,
  channelManager,
  seedSources,
  runtimeHello: runtimeDelivery.hello,
  schedulesBoot,
  runtimeMutator: runtimeDelivery.runtimeMutator,
});

// ADR-041: instance identity for ext-authz now flows from the per-instance
// ext-authz Service the gateway pod's Envoy was configured to dial,
// cryptographically pinned by the AuthorizationPolicy on each per-instance
// Service. The pod-IP resolver and `x-platform-instance` header are gone.
//
// Single gRPC ext_authz server serves both Envoy filters: HTTP filter on
// TLS-terminated chains (L7 — sees method/path) and the network filter on
// the catch-all chain (L4 — SNI only). Same Check RPC, same gate service;
// the handler reads what's populated and falls back to wildcards otherwise.
const { server: extAuthzGrpcServer } = await startExtAuthzGrpcApp({
  port: config.extAuthzPort,
  holdSeconds: config.approvalHoldSeconds,
  gate: extAuthzGate,
  releaseName: config.releaseName,
});

listChannelsByOwner(db, "")()
  .then((channelsByInstance) => {
    channelManager.bootstrap(channelsByInstance);
  })
  .catch(() => {});

async function shutdown() {
  process.stderr.write("shutting down...\n");
  channelSecretCleanupSub.unsubscribe();
  channelCleanupSub.unsubscribe();
  skillsCleanupSub.unsubscribe();
  onForeignReplySub.unsubscribe();
  onChannelTurnRelayedSub.unsubscribe();
  usage.stop();
  audit.stop();
  await deliverySweeper.stop();
  await agentArtifactsSweeper.stop();
  await channelManager.stopAll();
  await runtimeDelivery.sweep.stop();
  await runtimeDelivery.worker.close();
  await runtimeDelivery.queue.close();
  await schedulesBoot.close();
  await redisBus.close();
  await sql.end();
  extAuthzGrpcServer.tryShutdown(() => {});
  harnessApiServer.close();
  apiServer.close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
