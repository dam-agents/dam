import { createDb, runMigrations } from "db";
import { createApi } from "./modules/agents/infrastructure/k8s.js";
import {
  composeAgentsModule,
  createAgentsRepository,
  createKeycloakUserDirectory,
  startK8sCleanupSaga,
  startChannelCleanupSaga,
  deleteChannelsByAgent,
  listChannelsByOwner,
  findBySlackChannelId,
  findSlackChannelByAgent,
} from "./modules/agents/index.js";
import { SessionMode, SessionType } from "api-server-api";
import {
  upsertSession,
  findByInstanceAndThreadTs,
  touchSession,
} from "./modules/sessions/index.js";
import {
  createAgentSkillsRepository,
  parseSeedSources,
  startSkillsCleanupSaga,
} from "./modules/skills/index.js";
import { createK8sClient } from "./modules/agents/infrastructure/k8s.js";
import { createPostgresState } from "@chat-adapter/state-pg";
import {
  createSlackWorker,
  type SlackOAuthPending,
  type ChannelRegistry,
} from "./modules/channels/infrastructure/slack.js";
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
} from "./modules/channels/infrastructure/telegram-threads-repository.js";
import { createOAuthRefreshService } from "./modules/connections/services/oauth-refresh-service.js";
import { createPodFilesBus } from "./modules/pod-files/bus.js";
import { createPodFilesPublisher } from "./modules/pod-files/publisher.js";
import { buildPodFilesRegistry } from "./modules/pod-files/registry.js";
import { createGrantedConnectionsAdapter } from "./modules/pod-files/adapters/granted-connections.js";
import {
  composeForksModule,
  startOnForeignReplySaga,
  startOnSlackTurnRelayedSaga,
} from "./modules/forks/index.js";
import { createK8sForkOrchestrator } from "./modules/forks/infrastructure/k8s-fork-orchestrator.js";
import { loadConfig } from "./config.js";
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
import { podBaseUrl } from "./modules/agents/infrastructure/k8s.js";

const config = loadConfig();

const { api } = createApi(config.namespace);
await runMigrations(config.databaseUrl, config.migrationsPath);
const { db, sql } = createDb(config.databaseUrl);

const k8sClient = createK8sClient(api, config.namespace);
const agentsRepo = createAgentsRepository(k8sClient);
const channelSecretStore = createChannelSecretStore(k8sClient);

const k8sCleanupSub = startK8sCleanupSaga(k8sClient, channelSecretStore);
const channelCleanupSub = startChannelCleanupSaga(
  deleteChannelsByAgent(db),
  deleteThreadsByAgent(db),
);
const skillsCleanupSub = startSkillsCleanupSaga((agentId) =>
  createAgentSkillsRepository(db).deleteByAgent(agentId),
);
const seedSources = parseSeedSources(config.skillSourcesSeed);

const { forks } = composeForksModule({
  orchestrator: createK8sForkOrchestrator({ api, namespace: config.namespace }),
});

const onForeignReplySub = startOnForeignReplySaga(forks);
const onSlackTurnRelayedSub = startOnSlackTurnRelayedSaga(forks);

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
});
const persistSession = upsertSession(db);
const persistSlackSession = (
  sessionId: string,
  agentId: string,
  type: SessionType,
  threadTs?: string,
) =>
  persistSession(
    sessionId,
    agentId,
    SessionMode.Chat,
    type,
    undefined,
    threadTs,
  );
const persistTelegramSession = (
  sessionId: string,
  agentId: string,
  type: SessionType,
  threadId?: string,
) =>
  persistSession(
    sessionId,
    agentId,
    SessionMode.Chat,
    type,
    undefined,
    threadId,
  );

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

const chatSdkState = config.telegramEnabled
  ? createPostgresState({ url: config.databaseUrl, keyPrefix: "chat-sdk" })
  : undefined;

const channelRegistry: ChannelRegistry = {
  resolveInstanceBySlackChannel: async (slackChannelId) =>
    (await findBySlackChannelId(db)(slackChannelId))?.agentId ?? null,
  resolveSlackChannelByInstance: findSlackChannelByAgent(db),
};

const slackWorker =
  config.slackBotToken && config.slackAppToken
    ? createSlackWorker(
        config.namespace,
        config.slackBotToken,
        config.slackAppToken,
        () => systemAgents,
        persistSlackSession,
        identityLinkService,
        {
          keycloakExternalUrl: config.keycloakExternalUrl,
          keycloakUrl: config.keycloakUrl,
          keycloakRealm: config.keycloakRealm,
          keycloakClientId: config.keycloakClientId,
          callbackUrl: slackOauthCallbackUrl,
        },
        pendingSlackOAuthFlows,
        {
          find: findByInstanceAndThreadTs(db),
          touch: touchSession(db),
        },
        (agentId) => agentsRepo.getOwner(agentId),
        channelRegistry,
        config.brand.short,
      )
    : undefined;

const telegramWorker =
  config.telegramEnabled && chatSdkState
    ? createTelegramWorker(
        config.namespace,
        chatSdkState,
        () => systemAgents,
        persistTelegramSession,
        {
          isAuthorized: isThreadAuthorized(db),
          authorize: authorizeThread(db),
          list: listAuthorizedThreads(db),
          revoke: revokeThread(db),
        },
        {
          keycloakExternalUrl: config.keycloakExternalUrl,
          keycloakUrl: config.keycloakUrl,
          keycloakRealm: config.keycloakRealm,
          keycloakClientId: config.keycloakClientId,
          callbackUrl: telegramOauthCallbackUrl,
        },
        pendingTelegramOAuthFlows,
        {
          find: findByInstanceAndThreadTs(db),
          touch: touchSession(db),
        },
      )
    : undefined;

const channelManager = createChannelManager({
  slackWorker,
  telegramWorker,
  channelSecretStore,
});

// Pod-files plumbing — see 034-pod-files-push. The github-enterprise
// hosts.yml producer is the first registry entry; future producers (secrets-
// as-files, schedule-driven config, …) plug into the same publisher and SSE
// channel without changes elsewhere.
const podFilesBus = createPodFilesBus();
const podFilesRegistry = buildPodFilesRegistry({
  // Agent HOME from the helm chart. Must agree with the controller's mount
  // path; both read the same chart value.
  agentHome: config.agentHome,
  // Resolves an agent's granted connection records against live K8s state
  // (instance CM annotations for grants, owner-scoped connection Secrets
  // for the records). Two API calls per snapshot — fine for the SSE-connect
  // and grant-change cadence.
  fetchAgentGrantedConnections: createGrantedConnectionsAdapter(k8sClient),
});
const podFilesPublisher = createPodFilesPublisher({
  bus: podFilesBus,
  registry: podFilesRegistry,
});

if (!config.redisUrl)
  throw new Error(
    "REDIS_URL is required (Redis is a platform primitive — see ADR-036)",
  );
const redisBus = createRedisBus(config.redisUrl, {
  password: config.redisPassword ?? undefined,
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
const agentCleanupHooks = [
  createEgressRulesCleanupHook(db),
  createApprovalsCleanupHook(db),
];

// Cross-store orphan reaper. Lists live agent ConfigMaps, finds DB rows
// keyed by an agent_id no longer in the live set, and runs each module's
// cleanup. Runs on every replica — DELETEs are idempotent, the random
// initial-delay jitter spreads scans out.
const agentArtifactsSweeper = createAgentArtifactsSweeper({
  k8s: createAgentsK8sClient(api, config.namespace),
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
  ],
  intervalMs: 30 * 60_000,
  batchSize: 200,
});
agentArtifactsSweeper.start();

const { server: apiServer } = startApiServerApp({
  config,
  api,
  db,
  channelManager,
  channelSecretStore,
  identityLinkService,
  pendingSlackOAuthFlows,
  pendingTelegramOAuthFlows,
  podFilesPublisher,
  seedSources,
  redisBus,
  approvalsRelay,
  wrapperFrameSender,
  presetSeeder,
  trustedHosts,
  agentCleanupHooks,
});

// Re-mints OAuth access tokens from stored refresh tokens before they expire
// (ADR-033 § "Token provisioning and refresh"). Single-process — multi-replica
// leader election is a follow-up.
const oauthRefreshService = createOAuthRefreshService({ k8sClient });
oauthRefreshService.start();

const { server: harnessApiServer } = startHarnessApiServerApp({
  config,
  api,
  db,
  channelManager,
  channelSecretStore,
  podFilesBus,
  podFilesSnapshot: podFilesPublisher.compute,
  seedSources,
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
  k8sCleanupSub.unsubscribe();
  channelCleanupSub.unsubscribe();
  skillsCleanupSub.unsubscribe();
  onForeignReplySub.unsubscribe();
  onSlackTurnRelayedSub.unsubscribe();
  await oauthRefreshService.stop();
  await deliverySweeper.stop();
  await agentArtifactsSweeper.stop();
  await channelManager.stopAll();
  await redisBus.close();
  await sql.end();
  extAuthzGrpcServer.tryShutdown(() => {});
  harnessApiServer.close();
  apiServer.close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
