import type * as k8s from "@kubernetes/client-node";
import type { Subscription } from "rxjs";
import type { Db } from "db";
import { createXactLock } from "../../core/xact-lock.js";
import type { AgentsService, ConnectionsService } from "api-server-api";
import { createK8sClient } from "./infrastructure/k8s.js";
import type { AgentStateCache } from "./infrastructure/agent-state-cache.js";
import { createAgentRegistrySecretPort } from "./infrastructure/agent-registry-secret-port.js";
import { createPodStatusClient } from "./infrastructure/pod-status-client.js";
import { createUnitOfWork } from "../../core/unit-of-work.js";
import {
  createAgentsRepository,
  type AgentsRepository,
} from "./infrastructure/agents-repository.js";
import { createAgentEnvRepository } from "./infrastructure/agent-env-repository.js";
import {
  createAgentsService,
  type AgentCleanupHook,
  type PresetSeeder,
  type ContributionsProgressPort,
  type OnboardingChecklistReader,
  type ResizeGatePort,
  type TelegramBindingPort,
  type SlackBindingPort,
} from "./services/agents-service.js";
import {
  hasAnyBinding,
  listChannelsByOwner,
  listChannelsByAgent,
  deleteChannelByType,
  deleteSlackChannelByAgent,
  deleteChannelsByAgentIds,
  findSlackBindingsByChannelId,
  claimSlackDefaultIfVacantTx,
  upsertChannelTx,
  listChannelsByAgentTx,
} from "./infrastructure/channel-bindings-repository.js";
import {
  getProfile,
  upsertProfile,
  tombstoneProfile,
  retireProfile,
  listLiveProfileAgentIds,
  listProfileIdsForReconcile,
} from "./infrastructure/public-agent-profile-repository.js";
import {
  createPublicAgentPageService,
  type PublicAgentIdentity,
  type PublicAgentPageService,
} from "./services/public-agent-page-service.js";
import {
  createPublicAgentProfileReconcileService,
  type PublicAgentProfileReconcileService,
} from "./services/public-agent-profile-reconcile-service.js";
import { startPersistPublicAgentProfileSaga } from "./sagas/persist-public-agent-profile.js";
import type { KeycloakUserDirectory } from "./infrastructure/keycloak-user-directory.js";
import type { ReadTemplateSpec } from "../templates/index.js";
import type { RuntimeMutator } from "../runtime-delivery/index.js";

type AgentsServiceDeps = Parameters<typeof createAgentsService>[0];

export function composeAgentsModule(deps: {
  api: k8s.CoreV1Api;
  resolveSlackWorkspace: AgentsServiceDeps["resolveSlackWorkspace"];
  agentStateCache: AgentStateCache;
  namespace: string;
  agentIdleTimeoutMinutes: number;
  agentDefaultLimits: { cpu: string; memory: string };
  virtualizationEnabled?: boolean;
  resizeGate?: ResizeGatePort;
  owner: string | undefined;
  db: Db;
  readTemplateSpec: ReadTemplateSpec;
  presetSeeder?: PresetSeeder;
  cleanupHooks: readonly AgentCleanupHook[];
  runtimeMutator: RuntimeMutator;
  contributionsProgress: ContributionsProgressPort;
  onboardingChecklists: OnboardingChecklistReader;
  telegramBinding?: TelegramBindingPort;
  slackBinding?: SlackBindingPort;
  resolveSlackChannelNames?: AgentsServiceDeps["resolveSlackChannelNames"];
  grantProvisioner?: AgentsServiceDeps["grantProvisioner"];
}): {
  agents: AgentsService;
  isOwnedAgent: (agentId: string) => Promise<boolean>;
} {
  const k8s = createK8sClient(deps.api, deps.namespace);
  const repo = createAgentsRepository(k8s, deps.agentStateCache);
  const agentEnvRepo = createAgentEnvRepository(deps.db);
  const registrySecretPort = createAgentRegistrySecretPort(k8s);
  const owner = deps.owner ?? "";
  return {
    agents: createAgentsService({
      repo,
      agentEnvRepo,
      agentIdleTimeoutMinutes: deps.agentIdleTimeoutMinutes,
      agentDefaultLimits: deps.agentDefaultLimits,
      virtualizationEnabled: deps.virtualizationEnabled,
      resizeGate: deps.resizeGate,
      resizeLock: createXactLock(deps.db),
      owner: deps.owner,
      readTemplateSpec: deps.readTemplateSpec,
      presetSeeder: deps.presetSeeder,
      cleanupHooks: deps.cleanupHooks,
      registrySecretPort,
      runtimeMutator: deps.runtimeMutator,
      contributionsProgress: deps.contributionsProgress,
      onboardingChecklists: deps.onboardingChecklists,
      podStatus: createPodStatusClient(deps.namespace),
      grantProvisioner: deps.grantProvisioner,
      listChannelsByOwner: listChannelsByOwner(deps.db, owner),
      listChannelsByAgent: listChannelsByAgent(deps.db, owner),
      deleteChannelByType: deleteChannelByType(deps.db, owner),
      deleteSlackChannelByAgent: deleteSlackChannelByAgent(deps.db, owner),
      deleteChannelsByAgentIds: deleteChannelsByAgentIds(deps.db, owner),
      unitOfWork: createUnitOfWork(deps.db),
      channelsTxRepo: {
        upsertChannel: (tx, agentId, channel) =>
          upsertChannelTx(tx, owner, agentId, channel),
        listByAgent: (tx, agentId) => listChannelsByAgentTx(tx, owner, agentId),
        claimDefaultIfVacant: (tx, agentId, slackChannelId) =>
          claimSlackDefaultIfVacantTx(tx, owner, agentId, slackChannelId),
      },
      findSlackBindings: findSlackBindingsByChannelId(deps.db),
      resolveSlackWorkspace: deps.resolveSlackWorkspace,
      telegramBinding: deps.telegramBinding,
      slackBinding: deps.slackBinding,
      resolveSlackChannelNames: deps.resolveSlackChannelNames,
    }),
    isOwnedAgent: (agentId) =>
      deps.owner ? repo.isOwnedBy(agentId, deps.owner) : Promise.resolve(true),
  };
}

export function composePublicAgentPage(deps: {
  db: Db;
  repo: AgentsRepository;
  userDirectory: KeycloakUserDirectory;
  log: (message: string) => void;
}): {
  service: PublicAgentPageService;
  startSaga: () => Subscription;
  reconcileService: PublicAgentProfileReconcileService;
  listLiveAgentIds: () => Promise<string[]>;
  retireProfile: (agentId: string) => Promise<void>;
} {
  const readAgent = async (
    agentId: string,
  ): Promise<PublicAgentIdentity | null> => {
    const agent = await deps.repo.get(agentId);
    if (!agent?.owner) return null;
    return { name: agent.name, ownerSub: agent.owner };
  };
  const upsert = upsertProfile(deps.db);
  const tombstone = tombstoneProfile(deps.db);
  const retire = retireProfile(deps.db);
  const bound = hasAnyBinding(deps.db);

  return {
    service: createPublicAgentPageService({
      hasAnyBinding: bound,
      getProfile: getProfile(deps.db),
      upsertProfile: upsert,
      tombstoneProfile: tombstone,
      readAgent,
      resolveOwnerName: (ownerSub) =>
        deps.userDirectory.resolveDisplayNameBySub(ownerSub),
      log: deps.log,
    }),
    listLiveAgentIds: listLiveProfileAgentIds(deps.db),
    retireProfile: retire,
    startSaga: () =>
      startPersistPublicAgentProfileSaga({
        hasAnyBinding: bound,
        readAgent,
        upsertProfile: upsert,
        tombstoneProfile: tombstone,
        log: deps.log,
      }),
    reconcileService: createPublicAgentProfileReconcileService({
      listProfileIds: listProfileIdsForReconcile(deps.db),
      readAgent,
      upsertProfile: upsert,
      retireProfile: retire,
      log: deps.log,
    }),
  };
}

export function connectionGrantProvisioner(
  connections: Pick<
    ConnectionsService,
    "validateProviderConnection" | "validateGrantSet" | "setAgentConnections"
  >,
): NonNullable<AgentsServiceDeps["grantProvisioner"]> {
  return {
    async resolveSpecGrants(sel) {
      if (sel.providerConnectionId)
        await connections.validateProviderConnection(sel.providerConnectionId);
      await connections.validateGrantSet(sel.connectionIds);
      return {
        grantedConnectionIds: Array.from(new Set(sel.connectionIds)),
      };
    },
    async applyAfterCreate(agentId, sel) {
      if (sel.connectionIds.length)
        await connections.setAgentConnections(agentId, sel.connectionIds);
    },
  };
}
