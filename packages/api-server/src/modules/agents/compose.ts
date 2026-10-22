import { PROVIDER_TEMPLATE_IDS, type HarnessCatalog } from "api-server-api";
import type { InfraAgent } from "./infrastructure/agent-mappers.js";
import type * as k8s from "@kubernetes/client-node";
import type { Subscription } from "rxjs";
import type { Db } from "db";
import { createXactLock } from "../../core/xact-lock.js";
import type { AgentsService, ConnectionsService } from "api-server-api";
import { createK8sClient } from "./infrastructure/k8s.js";
import type { IdleTimeoutMinutes } from "./domain/spec-assembly.js";
import type { AgentStateCache } from "./infrastructure/agent-state-cache.js";
import { createAgentRegistrySecretPort } from "./infrastructure/agent-registry-secret-port.js";
import { createAgentSecretRefPort } from "./infrastructure/agent-secret-ref-port.js";
import { createPodStatusClient } from "./infrastructure/pod-status-client.js";
import { createUnitOfWork } from "../../core/unit-of-work.js";
import {
  createAgentsRepository,
  type AgentsRepository,
} from "./infrastructure/agents-repository.js";
import { createAgentsRuntimeRepo } from "../runtime-delivery/infrastructure/outbox-repo.js";
import { createAgentEnvRepository } from "./infrastructure/agent-env-repository.js";
import {
  createAgentsService,
  type AgentCleanupHook,
  type PresetSeeder,
  type ContributionsProgressPort,
  type OnboardingChecklistReader,
  type ResizeGatePort,
  type StorageGatePort,
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
import { harnessFits, type ReadTemplateSpec } from "../templates/index.js";
import type { RuntimeMutator } from "../runtime-delivery/index.js";

type AgentsServiceDeps = Parameters<typeof createAgentsService>[0];

export interface AgentsInstallSettings {
  virtualizationEnabled: boolean;
  defaultHarness: string;
  telemetry: boolean;
}

export function composeAgentsModule(deps: {
  api: k8s.CoreV1Api;
  resolveSlackWorkspace: AgentsServiceDeps["resolveSlackWorkspace"];
  agentStateCache: AgentStateCache;
  namespace: string;
  agentIdleTimeoutMinutes: IdleTimeoutMinutes;
  agentDefaultLimits: { cpu: string; memory: string };
  install: AgentsInstallSettings;
  resizeGate?: ResizeGatePort;
  storageGate?: StorageGatePort;
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
  resolveSlackConversationLabels?: AgentsServiceDeps["resolveSlackConversationLabels"];
  readSlackLoopGuardDrops: NonNullable<
    AgentsServiceDeps["readSlackLoopGuardDrops"]
  >;
  grantProvisioner?: AgentsServiceDeps["grantProvisioner"];
}): {
  agents: AgentsService;
  isOwnedAgent: (agentId: string) => Promise<boolean>;
} {
  const k8s = createK8sClient(deps.api, deps.namespace);
  const repo = createAgentsRepository(k8s, deps.agentStateCache);
  const agentEnvRepo = createAgentEnvRepository(deps.db);
  const agentsRuntimeRepo = createAgentsRuntimeRepo(deps.db);
  const registrySecretPort = createAgentRegistrySecretPort(k8s);
  const owner = deps.owner ?? "";
  return {
    agents: createAgentsService({
      repo,
      agentEnvRepo,
      agentIdleTimeoutMinutes: deps.agentIdleTimeoutMinutes,
      agentDefaultLimits: deps.agentDefaultLimits,
      virtualizationEnabled: deps.install.virtualizationEnabled,
      defaultHarness: deps.install.defaultHarness,
      telemetry: deps.install.telemetry,
      resizeGate: deps.resizeGate,
      storageGate: deps.storageGate,
      resizeLock: createXactLock(deps.db),
      owner: deps.owner,
      readTemplateSpec: deps.readTemplateSpec,
      lastHelloAt: async (agentId) =>
        (await agentsRuntimeRepo.get(agentId))?.runtimeLastHelloAt ?? null,
      presetSeeder: deps.presetSeeder,
      cleanupHooks: deps.cleanupHooks,
      registrySecretPort,
      secretRefs: createAgentSecretRefPort(k8s),
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
      resolveSlackConversationLabels: deps.resolveSlackConversationLabels,
      readSlackLoopGuardDrops: deps.readSlackLoopGuardDrops,
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

type ProvisionerConnections = Pick<
  ConnectionsService,
  | "validateProviderConnection"
  | "validateGrantSet"
  | "setAgentConnections"
  | "defaultProviderConnections"
  | "listConnections"
>;

async function fittingProviders(
  connections: ProvisionerConnections,
  catalog: Pick<HarnessCatalog, "harnesses">,
  connectionIds: string[],
  { harness, providers }: { harness?: string; providers?: readonly string[] },
  upTo?: string,
): Promise<string[]> {
  const chosen = new Set(connectionIds);
  const holdsProvider = (await connections.listConnections()).some(
    (c) => chosen.has(c.id) && PROVIDER_TEMPLATE_IDS.has(c.templateId),
  );
  return holdsProvider
    ? []
    : connections.defaultProviderConnections(
        (type, templateId) =>
          harness !== undefined &&
          catalog.harnesses.some((h) => h.name === harness)
            ? harnessFits(catalog, harness, type, templateId)
            : !providers || providers.includes(type),
        harness,
        upTo,
      );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: what a new Agent is granted besides the
 * Connections its create names. With no provider among them it gets one: the
 * first provider of the owner's its harness runs on, in the harness's alias
 * order, the order a default provider is resolved in. One provider, not every
 * fitting one, so the default its runtime saves at its first hello has one
 * provider to sit on and is the image's preset model, and no call goes to a
 * provider the owner never chose for this Agent.
 */
export function connectionGrantProvisioner(
  connections: ProvisionerConnections,
  catalog: Pick<HarnessCatalog, "harnesses">,
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
    async defaultProviders(connectionIds, template) {
      return (
        await fittingProviders(connections, catalog, connectionIds, template)
      ).slice(0, 1);
    },
    async applyAfterCreate(agentId, sel) {
      if (sel.connectionIds.length)
        await connections.setAgentConnections(agentId, sel.connectionIds);
    },
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Gives a just-connected provider to each of the
 * owner's agents that holds none, when it is the first provider that agent's
 * default would grant: the agent predates every provider its harness runs
 * on. Age decides, not the count of the owner's providers, because several
 * providers created together all exist before this runs: the default is read
 * as of this connection, and the ones created after it are cut off. An agent
 * whose default holds an older provider was detached on purpose and is left
 * without one, and an Environment never gets one: only its owner grants it a
 * connection, in the app. One agent failing does not keep the provider from
 * the rest.
 */
export async function attachProviderToBareAgents(
  connections: ProvisionerConnections &
    Pick<ConnectionsService, "getAgentConnections" | "updateAgentConnections">,
  catalog: Pick<HarnessCatalog, "harnesses">,
  agents: readonly {
    id: string;
    spec: Pick<InfraAgent["spec"], "harness" | "environmentOf">;
  }[],
  connectionId: string,
): Promise<void> {
  const failed: unknown[] = [];
  for (const agent of agents) {
    if (agent.spec.environmentOf) continue;
    try {
      const { connections: grants } = await connections.getAgentConnections(
        agent.id,
      );
      const chosen = await fittingProviders(
        connections,
        catalog,
        grants.map((g) => g.connectionId),
        agent.spec.harness ? { harness: agent.spec.harness } : {},
        connectionId,
      );
      if (chosen.length === 1 && chosen[0] === connectionId)
        await connections.updateAgentConnections(agent.id, {
          grant: [connectionId],
          revoke: [],
        });
    } catch (err) {
      failed.push(err);
    }
  }
  if (failed.length > 0)
    throw new AggregateError(failed, `${failed.length} agent(s) not attached`);
}
