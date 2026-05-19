import type * as k8s from "@kubernetes/client-node";
import type { Db } from "db";
import type { AgentsService } from "api-server-api";
import { createK8sClient } from "./infrastructure/k8s.js";
import { createUnitOfWork } from "../../core/unit-of-work.js";
import type { ChannelSecretStore } from "../channels/infrastructure/channel-secret-store.js";
import {
  createAgentsRepository,
  type AgentsRepository,
} from "./infrastructure/agents-repository.js";
import {
  createAgentsService,
  type AgentCleanupHook,
  type PresetSeeder,
} from "./services/agents-service.js";
import {
  listChannelsByOwner,
  listChannelsByAgent,
  upsertChannel,
  deleteChannelByType,
  deleteChannelsByAgentIds,
  upsertChannelTx,
  listChannelsByAgentTx,
} from "./infrastructure/channel-bindings-repository.js";
import {
  listAllowedUsersByOwner,
  listAllowedUsersByAgent,
  setAllowedUsers,
  deleteAllowedUsersByAgentIds,
} from "./infrastructure/allowed-users-repository.js";
import type { KeycloakUserDirectory } from "./infrastructure/keycloak-user-directory.js";
import type { ReadTemplateSpec } from "../templates/index.js";

export type {
  AgentCleanupHook,
  PresetSeeder,
} from "./services/agents-service.js";

export function composeAgentsModule(deps: {
  api: k8s.CoreV1Api;
  namespace: string;
  /** `undefined` enables system-level composition (cross-owner) for the
   *  Slack/Telegram workers that read agents owned by anyone. */
  owner: string | undefined;
  db: Db;
  userDirectory: KeycloakUserDirectory;
  channelSecretStore: ChannelSecretStore;
  readTemplateSpec: ReadTemplateSpec;
  presetSeeder?: PresetSeeder;
  cleanupHooks?: readonly AgentCleanupHook[];
}): {
  agents: AgentsService;
  repo: AgentsRepository;
  isOwnedAgent: (agentId: string) => Promise<boolean>;
} {
  const k8s = createK8sClient(deps.api, deps.namespace);
  const repo = createAgentsRepository(k8s);
  // For DB-scoped lookups, an undefined owner means "system-wide". The
  // Postgres queries that already accept an empty-string owner-filter
  // (channels/allowed_users repos) treat "" as "match all" — keep that.
  const owner = deps.owner ?? "";
  return {
    agents: createAgentsService({
      repo,
      owner: deps.owner,
      readTemplateSpec: deps.readTemplateSpec,
      presetSeeder: deps.presetSeeder,
      cleanupHooks: deps.cleanupHooks,
      listChannelsByOwner: listChannelsByOwner(deps.db, owner),
      listChannelsByAgent: listChannelsByAgent(deps.db, owner),
      upsertChannel: upsertChannel(deps.db, owner),
      deleteChannelByType: deleteChannelByType(deps.db, owner),
      deleteChannelsByAgentIds: deleteChannelsByAgentIds(deps.db, owner),
      unitOfWork: createUnitOfWork(deps.db),
      channelsTxRepo: {
        upsertChannel: (tx, agentId, channel) =>
          upsertChannelTx(tx, owner, agentId, channel),
        listByAgent: (tx, agentId) => listChannelsByAgentTx(tx, owner, agentId),
      },
      channelSecretStore: deps.channelSecretStore,
      listAllowedUsersByOwner: listAllowedUsersByOwner(deps.db, owner),
      listAllowedUsersByAgent: listAllowedUsersByAgent(deps.db, owner),
      setAllowedUsers: setAllowedUsers(deps.db, owner),
      deleteAllowedUsersByAgentIds: deleteAllowedUsersByAgentIds(
        deps.db,
        owner,
      ),
      userDirectory: deps.userDirectory,
    }),
    repo,
    isOwnedAgent: (agentId) =>
      deps.owner ? repo.isOwnedBy(agentId, deps.owner) : Promise.resolve(true),
  };
}
