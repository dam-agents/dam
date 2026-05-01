import { createDb, runMigrations } from "db";
import { createApi } from "./modules/agents/infrastructure/k8s.js";
import { composeSystemInstances, startK8sCleanupSaga, startChannelCleanupSaga } from "./modules/agents/index.js";
import {
  createInstanceSkillsRepository,
  parseSeedSources,
  startSkillsCleanupSaga,
} from "./modules/skills/index.js";
import { createK8sClient } from "./modules/agents/infrastructure/k8s.js";
import { createInstancesRepository } from "./modules/agents/infrastructure/instances-repository.js";
import { createKeycloakUserDirectory } from "./modules/agents/infrastructure/keycloak-user-directory.js";
import { deleteChannelsByInstance, listChannelsByOwner, findBySlackChannelId, findSlackChannelByInstance } from "./modules/agents/infrastructure/channels-repository.js";
import { upsertSession, findByInstanceAndThreadTs, touchSession } from "./modules/agents/infrastructure/sessions-repository.js";
import { createPostgresState } from "@chat-adapter/state-pg";
import { createSlackWorker, type SlackOAuthPending, type ChannelRegistry } from "./modules/channels/infrastructure/slack.js";
import { createTelegramWorker, type TelegramOAuthPending } from "./modules/channels/infrastructure/telegram.js";
import { createChannelManager } from "./modules/channels/services/channel-manager.js";
import { createChannelSecretStore } from "./modules/channels/infrastructure/channel-secret-store.js";
import { createIdentityLinkService } from "./modules/channels/services/identity-link-service.js";
import {
  findIdentityByExternalUser, upsertIdentityLink, deleteIdentityLink,
} from "./modules/channels/infrastructure/identity-links-repository.js";
import {
  isThreadAuthorized, authorizeThread, revokeThread, listAuthorizedThreads,
  deleteThreadsByInstance,
} from "./modules/channels/infrastructure/telegram-threads-repository.js";
import { composeConnectionsModule } from "./modules/connections/index.js";
import { createOAuthRefreshService } from "./modules/connections/services/oauth-refresh-service.js";
import { createPodFilesBus } from "./modules/pod-files/bus.js";
import { createPodFilesPublisher } from "./modules/pod-files/publisher.js";
import { buildPodFilesRegistry } from "./modules/pod-files/registry.js";
import {
  composeForksModule,
  startOnForeignReplySaga,
  startOnSlackTurnRelayedSaga,
} from "./modules/forks/index.js";
import { createK8sForkOrchestrator } from "./modules/forks/infrastructure/k8s-fork-orchestrator.js";
import { loadConfig } from "./config.js";
import { createOnecliClient } from "./apps/api-server/onecli.js";
import { startOnecliSyncSaga } from "./sagas/onecli-sync.js";
import { startApiServerApp } from "./apps/api-server/app.js";
import { startHarnessApiServerApp } from "./apps/harness-api-server/app.js";

const config = loadConfig();

const onecli = createOnecliClient({
  keycloakTokenUrl: `${config.keycloakUrl}/realms/${config.keycloakRealm}/protocol/openid-connect/token`,
  clientId: config.keycloakApiClientId,
  clientSecret: config.keycloakApiClientSecret,
  onecliAudience: config.onecliAudience,
  onecliBaseUrl: config.onecliBaseUrl,
});

const { api } = createApi(config.namespace);
await runMigrations(config.databaseUrl, config.migrationsPath);
const { db, sql } = createDb(config.databaseUrl);

const k8sClient = createK8sClient(api, config.namespace);
const instancesRepo = createInstancesRepository(k8sClient);
const channelSecretStore = createChannelSecretStore(k8sClient);

const k8sCleanupSub = startK8sCleanupSaga(k8sClient, channelSecretStore);
const channelCleanupSub = startChannelCleanupSaga(
  deleteChannelsByInstance(db),
  deleteThreadsByInstance(db),
);
const skillsCleanupSub = startSkillsCleanupSaga(
  (instanceId) => createInstanceSkillsRepository(db).deleteByInstance(instanceId),
);
const onecliSyncSub = startOnecliSyncSaga(onecli);

const seedSources = parseSeedSources(config.skillSourcesSeed);

const { foreignCredentials } = composeConnectionsModule({ onecli });

const { forks } = composeForksModule({
  foreignCredentials,
  orchestrator: createK8sForkOrchestrator({ api, namespace: config.namespace }),
});

// Resolves the parent instance's `experimentalCredentialInjector` flag at
// fork time. Failure → false: we fall back to the legacy OneCLI path rather
// than blocking the fork on a transient K8s read error. See ADR-033.
const onForeignReplySub = startOnForeignReplySaga(
  forks,
  async (instanceId) => {
    try {
      const inst = await instancesRepo.get(instanceId);
      return inst?.experimentalCredentialInjector ?? false;
    } catch (err) {
      process.stderr.write(`[forks/on-foreign-reply] flag-lookup ${instanceId}: ${err}\n`);
      return false;
    }
  },
);
const onSlackTurnRelayedSub = startOnSlackTurnRelayedSaga(forks);

const userDirectory = createKeycloakUserDirectory({
  keycloakUrl: config.keycloakUrl,
  keycloakRealm: config.keycloakRealm,
  clientId: config.keycloakApiClientId,
  clientSecret: config.keycloakApiClientSecret,
});

const systemInstances = composeSystemInstances(api, config.namespace, db, userDirectory, channelSecretStore, config.agentHome);
const persistSession = upsertSession(db);
const persistSlackSession: typeof persistSession = (sessionId, instanceId, type, threadTs?) =>
  persistSession(sessionId, instanceId, type, undefined, threadTs);
const persistTelegramSession: typeof persistSession = (sessionId, instanceId, type, threadId?) =>
  persistSession(sessionId, instanceId, type, undefined, threadId);

const identityLinkService = createIdentityLinkService({
  findByExternalUser: findIdentityByExternalUser(db),
  upsert: upsertIdentityLink(db),
  delete: deleteIdentityLink(db),
});

const pendingSlackOAuthFlows = new Map<string, SlackOAuthPending>();
const pendingTelegramOAuthFlows = new Map<string, TelegramOAuthPending>();

const slackOauthCallbackUrl = config.slackOauthCallbackUrl
  ?? `${config.uiBaseUrl}/api/slack/oauth/callback`;
const telegramOauthCallbackUrl = `${config.uiBaseUrl}/api/telegram/oauth/callback`;

const chatSdkState = config.telegramEnabled
  ? createPostgresState({ url: config.databaseUrl, keyPrefix: "chat-sdk" })
  : undefined;

const channelRegistry: ChannelRegistry = {
  resolveInstanceBySlackChannel: async (slackChannelId) =>
    (await findBySlackChannelId(db)(slackChannelId))?.instanceId ?? null,
  resolveSlackChannelByInstance: findSlackChannelByInstance(db),
};

const slackWorker = config.slackBotToken && config.slackAppToken
  ? createSlackWorker(
      config.namespace,
      config.slackBotToken,
      config.slackAppToken,
      () => systemInstances,
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
      (instanceId) => instancesRepo.getOwner(instanceId),
      channelRegistry,
    )
  : undefined;

const telegramWorker = config.telegramEnabled && chatSdkState
  ? createTelegramWorker(
      config.namespace,
      chatSdkState,
      () => systemInstances,
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

const channelManager = createChannelManager({ slackWorker, telegramWorker, channelSecretStore });

// Pod-files plumbing — see 034-pod-files-push. The github-enterprise
// hosts.yml producer is the first registry entry; future producers (secrets-
// as-files, schedule-driven config, …) plug into the same publisher and SSE
// channel without changes elsewhere.
const podFilesBus = createPodFilesBus();
const podFilesRegistry = buildPodFilesRegistry({
  // Agent HOME from the helm chart. Must agree with the controller's mount
  // path; both read the same chart value.
  agentHome: config.agentHome,
  /**
   * Returns only the connections **granted to `agentId`** under `owner`.
   * Mirrors what the UI's per-agent grant click writes (`setAgentConnections`)
   * — the file content reflects the explicit grant state, not the owner's
   * broader OneCLI inventory. Owner impersonation lets us call from background
   * contexts (snapshot path) without a live user JWT. Logs and returns empty
   * on transient OneCLI failures; next reconnect re-snapshots.
   */
  fetchAgentGrantedConnections: async (owner, agentId) => {
    const fetchJsonAs = async <T,>(path: string): Promise<T | null> => {
      const res = await onecli.onecliFetchAs(owner, path);
      if (!res.ok) {
        process.stderr.write(
          `pod-files: OneCLI ${path} for owner=${owner} agent=${agentId} → ${res.status}\n`,
        );
        return null;
      }
      return (await res.json()) as T;
    };

    const agents = await fetchJsonAs<Array<{ id: string; identifier: string }>>("/api/agents");
    if (!agents) return [];
    const agent = agents.find((a) => a.identifier === agentId);
    if (!agent) return [];

    const grantedIds = await fetchJsonAs<unknown[]>(
      `/api/agents/${encodeURIComponent(agent.id)}/connections`,
    );
    if (!grantedIds || grantedIds.length === 0) return [];
    const grantedSet = new Set(grantedIds.filter((x): x is string => typeof x === "string"));

    const all = await fetchJsonAs<Array<{
      id?: string;
      provider: string;
      metadata?: Record<string, unknown> | null;
    }>>("/api/connections");
    if (!all) return [];
    return all.filter((c) => typeof c.id === "string" && grantedSet.has(c.id));
  },
});
const podFilesPublisher = createPodFilesPublisher({
  bus: podFilesBus,
  registry: podFilesRegistry,
});

const { server: apiServer } = startApiServerApp({
  config, api, db, onecli, channelManager, channelSecretStore, identityLinkService,
  pendingSlackOAuthFlows, pendingTelegramOAuthFlows, podFilesPublisher, seedSources,
});

// Re-mints OAuth access tokens from stored refresh tokens before they expire
// (ADR-033 § "Token provisioning and refresh"). Single-process — multi-replica
// leader election is a follow-up.
const oauthRefreshService = createOAuthRefreshService({ k8sClient });
oauthRefreshService.start();

const { server: harnessApiServer } = startHarnessApiServerApp({
  config, api, db, channelManager, channelSecretStore,
  podFilesBus,
  podFilesSnapshot: podFilesPublisher.compute,
  seedSources,
});

listChannelsByOwner(db, "")().then((channelsByInstance) => {
  channelManager.bootstrap(channelsByInstance);
}).catch(() => {});

async function shutdown() {
  process.stderr.write("shutting down...\n");
  k8sCleanupSub.unsubscribe();
  channelCleanupSub.unsubscribe();
  skillsCleanupSub.unsubscribe();
  onecliSyncSub.unsubscribe();
  onForeignReplySub.unsubscribe();
  onSlackTurnRelayedSub.unsubscribe();
  await oauthRefreshService.stop();
  await channelManager.stopAll();
  await sql.end();
  harnessApiServer.close();
  apiServer.close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
