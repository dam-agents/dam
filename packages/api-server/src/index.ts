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
  createAgentEnvRepository,
  createAgentRegistrySecretPort,
  createKeycloakUserDirectory,
  backfillUserEnv,
  startChannelCleanupSaga,
  deleteChannelsByAgent,
  listChannelsByOwner,
  findBySlackChannelId,
  findSlackChannelByAgent,
  deleteSlackChannelBinding,
  setSlackChannelAmbient,
} from "./modules/agents/index.js";
import {
  createAgentSkillsRepository,
  parseSeedSources,
  startSkillsCleanupSaga,
} from "./modules/skills/index.js";
import { createK8sClient } from "./modules/agents/infrastructure/k8s.js";
import {
  createAcpClient,
  createForkAcpClient,
  type AcpClientFactory,
  type ForkAcpClientFactory,
} from "./core/acp-client.js";
import { createPostgresState } from "@chat-adapter/state-pg";
import {
  createSlackWorker,
  type SlackOAuthPending,
  type ChannelRegistry,
} from "./modules/channels/infrastructure/slack.js";
import { createBoltSlackGateway } from "./modules/channels/infrastructure/bolt-slack-gateway.js";
import { createFakeSlackGateway } from "./modules/channels/infrastructure/fake-slack-gateway.js";
import { createTelegramWorker } from "./modules/channels/infrastructure/telegram.js";
import { createChannelManager } from "./modules/channels/services/channel-manager.js";
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
import { composeSchedulesAtBoot } from "./modules/schedules/index.js";
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
import { listAgentIdsByOwner } from "./modules/usage/infrastructure/agents-postgres-repository.js";
import { composeMetricsReader } from "./modules/metrics/index.js";
import { composeAuditModule } from "./modules/audit/index.js";
import { createK8sForkOrchestrator } from "./modules/forks/infrastructure/k8s-fork-orchestrator.js";
import { composeE2eModule } from "./modules/e2e/compose.js";
import { composeTermsModule } from "./modules/terms/index.js";
import { loadConfig } from "./config.js";
import { configureLogger, getLogger } from "./core/logger.js";
import { startApiServerApp } from "./apps/api-server/app.js";
import { startHarnessApiServerApp } from "./apps/harness-api-server/app.js";
import { composeArtifactsModule } from "./modules/artifacts/compose.js";
import { createTemplatesRepository } from "./modules/templates/infrastructure/templates-repository.js";
import { composeTemplatesModule } from "./modules/templates/compose.js";
import { composeSandboxSweeper } from "./modules/sandboxes/index.js";
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
import {
  composeConnectionsAtBoot,
  composeConnectionsForOwner,
  createConnectionGrantsCleanupHook,
  listConnectionGrantAgentIds,
} from "./modules/connections/compose.js";
import { createConnectionsRepository } from "./modules/connections/infrastructure/connections-repository.js";
import { createConnectionRulesSyncAdapter } from "./modules/egress-rules/compose.js";
import { migrateSecretsToConnections } from "./modules/connections/migration/secrets-to-connections.js";
import { createLegacySecretEnvSource } from "./modules/connections/migration/legacy-secret-env-source.js";
import { createAgentArtifactsSweeper } from "./sagas/agent-artifacts-sweeper.js";
import { composeExperimentArmSweeper } from "./modules/experiments/index.js";
import { composeArtifactExpirySweeper } from "./modules/artifact-library/index.js";
import { createK8sClient as createAgentsK8sClient } from "./modules/agents/infrastructure/k8s.js";
import { loadTrustedHosts } from "./bootstrap/trusted-hosts.js";
import { createPeriodicJobs } from "./core/periodic-jobs.js";
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

// Candidate-artifact storage, shared by both app servers. ensureReady
// provisions the bucket and fails boot fast on an unreachable store.
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

const k8sClient = createK8sClient(api, config.namespace);
const agentsRepo = createAgentsRepository(k8sClient);
const agentEnvRepo = createAgentEnvRepository(db);

// Migrate pre-existing spec.env onto agent_env. First pass runs before serving;
// per-agent failures are isolated and retried on a timer until a clean pass.
let backfillRetry: ReturnType<typeof setTimeout> | undefined;
async function runUserEnvBackfill(): Promise<void> {
  const { failed } = await backfillUserEnv({
    repo: agentsRepo,
    agentEnvRepo,
    log: (m) => getLogger().info(`[user-env] ${m}`),
  });
  if (failed > 0)
    backfillRetry = setTimeout(() => void runUserEnvBackfill(), 60_000);
}
await runUserEnvBackfill();

// Concrete spec.resources.limits on legacy agents (#1900) are the
// controller's job: it materializes `legacyAgentSize` into any spec
// missing a dimension on reconcile (fill-if-absent) — watch-driven, so it
// also covers CRs created out-of-band, which a boot backfill here never
// could.

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
  // Inert safety (#1273): supplies credential env for any agent still on a
  // legacy secret until the migration flips it to a Connection (which then
  // carries its own env). Returns [] in the steady state. The controller's
  // kept host-pattern branch covers gateway injection but not this env half.
  secretEnv: createLegacySecretEnvSource({ k8sClient }),
});
runtimeDelivery.sweep.start();
const contributionsSettledPort = {
  status: runtimeDelivery.contributionsStatus,
  statusMany: runtimeDelivery.contributionsStatusMany,
};
const subPseudonymizer = createSubPseudonymizer(config.activityHmacKey);

const secretStores = createSecretStoreRegistry();
secretStores.register(createKubernetesSecretStore({ k8s: k8sClient }));

// Drain legacy provider/PAT secrets into Connections (#1273). Same shape as
// the user-env backfill: first pass awaited before serving, non-blocking
// (agents keep working on legacy secrets until each is flipped), timer-retry
// on partial failure, self-disarming once no legacy secrets remain. Runs with
// the api-server's cross-owner K8s reach — no owner-scoped surface needed.
const connectionsBoot = composeConnectionsAtBoot({
  db,
  secretStore: secretStores.default(),
});
const connectionsServiceFor = (ownerId: string) =>
  composeConnectionsForOwner({
    ownerId,
    db,
    templates: connectionsBoot.templates,
    oauthEngine: connectionsBoot.oauthEngine,
    secretStore: secretStores.default(),
    runtimeMutator: runtimeDelivery.runtimeMutator,
    agentsRepo,
    connectionRulesSync: createConnectionRulesSyncAdapter(db),
    oauthCallbackUrl: `${config.uiBaseUrl}/api/oauth/callback`,
    brandName: config.brand.name,
  });
let secretsMigrationRetry: ReturnType<typeof setTimeout> | undefined;
// Cap the retry chain so a credential that fails every pass (e.g. a genuinely
// unreadable Secret that surfaces as a transient error) can't re-arm a 60s
// timer forever. Past the cap we stop and log loud — an operator runs the
// dry-run entrypoint to inspect what's stuck.
const SECRETS_MIGRATION_MAX_RETRIES = 10;
let secretsMigrationRetries = 0;
async function runSecretsToConnectionsMigration(): Promise<void> {
  const { failed } = await migrateSecretsToConnections({
    k8sClient,
    repo: createConnectionsRepository(db),
    secretStore: secretStores.default(),
    connectionsServiceFor,
    connectionRulesSync: createConnectionRulesSyncAdapter(db),
    log: (m) => getLogger().info(`[secrets-migration] ${m}`),
  });
  if (failed === 0) return;
  if (secretsMigrationRetries >= SECRETS_MIGRATION_MAX_RETRIES) {
    getLogger().error(
      `[secrets-migration] still ${failed} failing after ` +
        `${SECRETS_MIGRATION_MAX_RETRIES} retries; giving up — agents keep ` +
        `working on legacy secrets, run the dry-run entrypoint to inspect`,
    );
    return;
  }
  secretsMigrationRetries++;
  secretsMigrationRetry = setTimeout(
    () => void runSecretsToConnectionsMigration(),
    60_000,
  );
}
await runSecretsToConnectionsMigration();

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
});

const channelCleanupSub = startChannelCleanupSaga(
  deleteChannelsByAgent(db),
  deleteConversationsByAgent(db),
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
  agentIdleTimeoutMinutes: config.agentIdleTimeoutMinutes,
  agentDefaultLimits: {
    cpu: config.agentDefaultCpuLimit,
    memory: config.agentDefaultMemoryLimit,
  },
  owner: undefined,
  db,
  userDirectory,
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
const telegramBindFlows = config.telegramBotToken
  ? createTelegramBindFlowStore()
  : undefined;
// Unconditional: a trivial in-memory store, needed whenever the Slack OAuth
// callback is mounted (real tokens or e2e). The bind command mints entries.
const slackBindFlows = createSlackBindFlowStore();
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
const chatSdkState = config.telegramBotToken
  ? createPostgresState({ url: chatSdkDatabaseUrl, keyPrefix: "chat-sdk" })
  : undefined;

const channelRegistry: ChannelRegistry = {
  resolveSlackBinding: async (slackChannelId) => {
    const row = await findBySlackChannelId(db)(slackChannelId);
    if (!row) return null;
    return {
      instanceName: row.agentId,
      owner: row.owner,
      ...(row.mode ? { mode: row.mode } : {}),
      ...(row.ambient ? { ambient: true } : {}),
    };
  },
  resolveSlackChannelByInstance: findSlackChannelByAgent(db),
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

// Bind the ACP turn ceiling (and namespace) into the client factories at the
// composition root; workers get pre-wired factories and stay ignorant of both.
const acpTurnCeilingMs = config.acpTurnCeilingSeconds * 1000;
const makeAcpClient: AcpClientFactory = (instanceName) =>
  createAcpClient({
    namespace: config.namespace,
    instanceName,
    turnCeilingMs: acpTurnCeilingMs,
  });
const makeForkAcpClient: ForkAcpClientFactory = (podIP) =>
  createForkAcpClient({ podIP, turnCeilingMs: acpTurnCeilingMs });

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
      { name: config.brand.name, short: config.brand.short },
      isTermsAccepted,
      config.uiBaseUrl,
      makeForkAcpClient,
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
      })
    : undefined;

const channelManager = createChannelManager({
  slackWorker,
  telegramWorker,
});

// Seed list for the `trusted` egress preset.
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
  // The presigned link is the per-request authorization for the store, so
  // no HITL decision. Bare hostname — the gate strips ports.
  platformAllowedHosts: config.objectStorageAgentEndpoint
    ? [new URL(config.objectStorageAgentEndpoint).hostname]
    : [],
});
deliverySweeper.start();

// Per-agent cleanup hooks fired after a successful K8s delete. Each
// module's adapter clears its own table; failures log + continue. The
// orphan-sweeper saga catches anything missed (replica died mid-delete,
// hook threw, etc.).
const agentsCleanupK8s = createAgentsK8sClient(api, config.namespace);
const registrySecretPort = createAgentRegistrySecretPort(agentsCleanupK8s);
const connectionGrantsCleanupHook = createConnectionGrantsCleanupHook(db);

const agentEnvCleanupHook = (agentId: string) =>
  agentEnvRepo.deleteForAgent(agentId);

const agentCleanupHooks = [
  createEgressRulesCleanupHook(db),
  createApprovalsCleanupHook(db),
  (agentId: string) => registrySecretPort.delete(agentId),
  connectionGrantsCleanupHook,
  agentEnvCleanupHook,
];

// Cross-store orphan reaper. Lists live agent CRs, finds DB rows keyed by
// an agent_id no longer in the live set, and runs each module's cleanup.
// Scheduled on the periodic-jobs queue below.
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
    {
      name: "connection-grants",
      listAgentIds: () => listConnectionGrantAgentIds(db),
      cleanup: connectionGrantsCleanupHook,
    },
    {
      name: "agent-env",
      listAgentIds: () => agentEnvRepo.listAgentIds(),
      cleanup: agentEnvCleanupHook,
    },
  ],
  batchSize: 200,
});

// Inactivity-deadline sweep: reaps `running` Experiment arms that have gone
// quiet (no Run, no finish_arm) past the configured window to `failed`, so a
// started Experiment always reaches a terminal state. Atomic conditional
// transitions make it multi-replica safe. Sweep at the window cadence, capped
// at 5 minutes so the default 1h window isn't scanned needlessly often.
const armInactivityMs = config.experimentArmInactivitySeconds * 1000;
const experimentArmSweeper = composeExperimentArmSweeper({
  db,
  inactivityMs: armInactivityMs,
  intervalMs: Math.min(armInactivityMs, 5 * 60_000),
  batchSize: 200,
});
experimentArmSweeper.start();

// Periodic background work runs as BullMQ job schedulers, one queue per job
// ("periodic.<name>") — one execution per period across replicas, and a
// hung tick can only stall its own lane. Ticks stay idempotent; the queue
// is scheduling and visibility, never correctness. The remaining interval
// sweepers (experiment arms, approvals delivery, cron sweep, OAuth refresh)
// migrate here incrementally.
const periodicJobs = createPeriodicJobs({
  connection: bullConnection,
  log: (msg) => process.stderr.write(`[periodic-jobs] ${msg}\n`),
});

// Cross-store orphan reap every 30 minutes — cheap diff scans, orphans are
// rare and non-urgent.
await periodicJobs.register("agent-artifacts-sweep", 30 * 60_000, () =>
  agentArtifactsSweeper.tick(),
);

// Artifact-library expiry sweep: hard-deletes artifacts (private ones too)
// whose expiry passed more than the grace window ago (the viewer 410s public
// ones meanwhile). Hourly is plenty — expiry granularity is hours.
const artifactExpirySweeper = composeArtifactExpirySweeper({
  db,
  artifacts: artifactsModule.service,
  batchSize: 200,
});
await periodicJobs.register("artifact-expiry-sweep", 60 * 60_000, () =>
  artifactExpirySweeper.tick(),
);
periodicJobs.start();

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

// Owner-scoped agents factory for the harness surface (the sandbox primitive):
// a driver agent spawns a sandbox = create an ephemeral Agent + submit a prompt.
// Mirrors the main app's per-owner agents composition, incl. the connections
// grantProvisioner so a sandbox's connection subset materializes on create.
const harnessTemplatesRepo = createTemplatesRepository(
  config.agentTemplatesPath,
);
const { readSpec: harnessReadTemplateSpec } =
  composeTemplatesModule(harnessTemplatesRepo);
const wakeAgentFor = async (agentId: string) => {
  await agentsRepo.wakeIfHibernated(agentId);
};
const harnessAgentsServiceFor = (owner: string) => {
  const connections = connectionsServiceFor(owner);
  return composeAgentsModule({
    api,
    namespace: config.namespace,
    agentIdleTimeoutMinutes: config.agentIdleTimeoutMinutes,
    agentDefaultLimits: {
      cpu: config.agentDefaultCpuLimit,
      memory: config.agentDefaultMemoryLimit,
    },
    owner,
    db,
    userDirectory,
    readTemplateSpec: harnessReadTemplateSpec,
    presetSeeder,
    cleanupHooks: agentCleanupHooks,
    runtimeMutator: runtimeDelivery.runtimeMutator,
    contributionsSettled: contributionsSettledPort,
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

// Liveness + auto-destroy sweep for sandbox nodes (owner-agnostic; started once).
const sandboxSweeper = composeSandboxSweeper({
  db,
  agentsFor: harnessAgentsServiceFor,
  k8s: k8sClient,
  intervalMs: 60_000,
  batchSize: 200,
});
sandboxSweeper.start();

const { server: apiServer } = startApiServerApp({
  config,
  api,
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
  contributionsSettled: contributionsSettledPort,
  getAgentCapabilities: (agentId) =>
    runtimeDelivery.agentsRuntimeRepo
      .get(agentId)
      .then((r) => r?.runtimeCapabilities ?? null),
  schedulesBoot,
  mountUsageRoutes: usage.mount,
  listRegisteredAgentIds: listAgentIdsByOwner(db, subPseudonymizer),
  metricsReader: composeMetricsReader(config),
  terms: termsService,
  isTermsAccepted,
  e2e: e2eService,
  artifacts,
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
  artifacts,
  agentsServiceFor: harnessAgentsServiceFor,
  connectionsServiceFor,
  wakeAgent: wakeAgentFor,
});

// Instance identity for ext-authz now flows from the per-instance
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
  if (backfillRetry) clearTimeout(backfillRetry);
  if (secretsMigrationRetry) clearTimeout(secretsMigrationRetry);
  channelCleanupSub.unsubscribe();
  skillsCleanupSub.unsubscribe();
  onForeignReplySub.unsubscribe();
  onChannelTurnRelayedSub.unsubscribe();
  usage.stop();
  audit.stop();
  await deliverySweeper.stop();
  await experimentArmSweeper.stop();
  await periodicJobs.close();
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
  // Flush OTel if the --import bootstrap (dist/telemetry.js) registered it.
  // Reached via Symbol lookup — importing telemetry.ts here would evaluate a
  // second copy of that bundle and split the SDK singleton.
  const flushOtel = (globalThis as Record<symbol, unknown>)[
    Symbol.for("platform.otel.shutdown")
  ];
  if (typeof flushOtel === "function") {
    await (flushOtel as () => Promise<void>)();
  }
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
