import type * as k8s from "@kubernetes/client-node";
import type { Db } from "db";
import type { AgentsService } from "api-server-api";
import { createK8sClient } from "./infrastructure/k8s.js";
import { createAgentRegistrySecretPort } from "./infrastructure/agent-registry-secret-port.js";
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
  type ContributionsSettledPort,
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
  findBySlackChannelId,
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
  /** Global default idle timeout in minutes; the per-agent override resolves against it. */
  agentIdleTimeoutMinutes: number;
  /** Chart-default agent size (limits), stamped concretely at create (#1900). */
  agentDefaultLimits: { cpu: string; memory: string };
  /** KubeVirt vm backend available in this install; absent = false (creating
   *  from a vm-backend template is rejected). */
  virtualizationEnabled?: boolean;
  /** Budget gate for live resizes (#1900); omitted by system compositions. */
  resizeGate?: ResizeGatePort;
  /** `undefined` enables system-level composition (cross-owner) for the
   *  Slack/Telegram workers that read agents owned by anyone. */
  owner: string | undefined;
  db: Db;
  readTemplateSpec: ReadTemplateSpec;
  presetSeeder?: PresetSeeder;
  cleanupHooks?: readonly AgentCleanupHook[];
  runtimeMutator: RuntimeMutator;
  contributionsSettled: ContributionsSettledPort;
  /** Telegram chat→agent binding flow; omitted system-side. */
  telegramBinding?: TelegramBindingPort;
  /** Slack in-chat channel→agent binding flow; omitted system-side. */
  slackBinding?: SlackBindingPort;
  /** Single-shot create; wired from connections. Omitted system-side. */
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
  // For DB-scoped lookups, an undefined owner means "system-wide". The
  // Postgres queries that already accept an empty-string owner-filter
  // (channels repo) treat "" as "match all" — keep that.
  const owner = deps.owner ?? "";
  return {
    agents: createAgentsService({
      repo,
      agentEnvRepo,
      agentIdleTimeoutMinutes: deps.agentIdleTimeoutMinutes,
      agentDefaultLimits: deps.agentDefaultLimits,
      virtualizationEnabled: deps.virtualizationEnabled,
      resizeGate: deps.resizeGate,
      owner: deps.owner,
      readTemplateSpec: deps.readTemplateSpec,
      presetSeeder: deps.presetSeeder,
      cleanupHooks: deps.cleanupHooks,
      registrySecretPort,
      runtimeMutator: deps.runtimeMutator,
      contributionsSettled: deps.contributionsSettled,
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
      },
      findSlackChannelBinding: findBySlackChannelId(deps.db),
      telegramBinding: deps.telegramBinding,
      slackBinding: deps.slackBinding,
    }),
    repo,
    isOwnedAgent: (agentId) =>
      deps.owner ? repo.isOwnedBy(agentId, deps.owner) : Promise.resolve(true),
  };
}
