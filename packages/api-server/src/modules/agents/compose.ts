import type * as k8s from "@kubernetes/client-node";
import type { Db } from "db";
import { createXactLock } from "../../core/xact-lock.js";
import type { AgentsService } from "api-server-api";
import { createK8sClient } from "./infrastructure/k8s.js";
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
  type ResizeGatePort,
  type TelegramBindingPort,
  type SlackBindingPort,
} from "./services/agents-service.js";
import {
  listChannelsByOwner,
  listChannelsByAgent,
  upsertChannel,
  deleteChannelByType,
  deleteSlackChannelByAgent,
  deleteChannelsByAgentIds,
  findSlackBindingsByChannelId,
  claimSlackDefaultIfVacantTx,
  upsertChannelTx,
  listChannelsByAgentTx,
} from "./infrastructure/channel-bindings-repository.js";
import type { ReadTemplateSpec } from "../templates/index.js";
import type { RuntimeMutator } from "../runtime-delivery/index.js";

export type {
  AgentCleanupHook,
  PresetSeeder,
} from "./services/agents-service.js";

export function composeAgentsModule(deps: {
  api: k8s.CoreV1Api;
  namespace: string;
  agentIdleTimeoutMinutes: number;
  agentDefaultLimits: { cpu: string; memory: string };
  virtualizationEnabled?: boolean;
  resizeGate?: ResizeGatePort;
  owner: string | undefined;
  db: Db;
  readTemplateSpec: ReadTemplateSpec;
  presetSeeder?: PresetSeeder;
  cleanupHooks?: readonly AgentCleanupHook[];
  runtimeMutator: RuntimeMutator;
  contributionsProgress: ContributionsProgressPort;
  telegramBinding?: TelegramBindingPort;
  slackBinding?: SlackBindingPort;
  grantProvisioner?: {
    resolveSpecGrants(sel: {
      connectionIds: string[];
    }): Promise<{ grantedConnectionIds: string[] }>;
    applyAfterCreate(
      agentId: string,
      sel: { connectionIds: string[] },
    ): Promise<void>;
  };
}): {
  agents: AgentsService;
  repo: AgentsRepository;
  isOwnedAgent: (agentId: string) => Promise<boolean>;
} {
  const k8s = createK8sClient(deps.api, deps.namespace);
  const repo = createAgentsRepository(k8s);
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
      podStatus: createPodStatusClient(deps.namespace),
      grantProvisioner: deps.grantProvisioner,
      listChannelsByOwner: listChannelsByOwner(deps.db, owner),
      listChannelsByAgent: listChannelsByAgent(deps.db, owner),
      upsertChannel: upsertChannel(deps.db, owner),
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
      telegramBinding: deps.telegramBinding,
      slackBinding: deps.slackBinding,
    }),
    repo,
    isOwnedAgent: (agentId) =>
      deps.owner ? repo.isOwnedBy(agentId, deps.owner) : Promise.resolve(true),
  };
}
