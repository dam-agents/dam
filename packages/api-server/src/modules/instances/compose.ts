import type * as k8s from "@kubernetes/client-node";
import type { Db } from "db";
import type { Agent, InstancesService } from "api-server-api";
import { createK8sClient } from "../agents/infrastructure/k8s.js";
import { createUnitOfWork } from "../../core/unit-of-work.js";
import type { ChannelSecretStore } from "../channels/infrastructure/channel-secret-store.js";
import { createInstancesRepository, type InstancesRepository } from "./infrastructure/instances-repository.js";
import {
  listChannelsByOwner, listChannelsByInstance,
  upsertChannel, deleteChannelByType,
  deleteChannelsByInstanceIds,
  upsertChannelTx, listChannelsByInstanceTx,
} from "./infrastructure/channel-bindings-repository.js";
import {
  listAllowedUsersByOwner, listAllowedUsersByInstance,
  setAllowedUsers, deleteAllowedUsersByInstanceIds,
} from "./infrastructure/allowed-users-repository.js";
import type { KeycloakUserDirectory } from "./infrastructure/keycloak-user-directory.js";
import { createInstancesService } from "./services/instances-service.js";

export function composeInstancesModule(deps: {
  api: k8s.CoreV1Api;
  namespace: string;
  owner: string | undefined;
  db: Db;
  userDirectory: KeycloakUserDirectory;
  channelSecretStore: ChannelSecretStore;
  getAgent: (id: string) => Promise<Agent | null>;
}): {
  instances: InstancesService;
  repo: InstancesRepository;
  isOwnedInstance: (instanceId: string) => Promise<boolean>;
} {
  const k8s = createK8sClient(deps.api, deps.namespace);
  const repo = createInstancesRepository(k8s);
  const ownerForDbScope = deps.owner ?? "";
  return {
    instances: createInstancesService({
      repo,
      owner: deps.owner,
      getAgent: deps.getAgent,
      listChannelsByOwner: listChannelsByOwner(deps.db, ownerForDbScope),
      listChannelsByInstance: listChannelsByInstance(deps.db, ownerForDbScope),
      upsertChannel: upsertChannel(deps.db, ownerForDbScope),
      deleteChannelByType: deleteChannelByType(deps.db, ownerForDbScope),
      deleteChannelsByInstanceIds: deleteChannelsByInstanceIds(deps.db, ownerForDbScope),
      unitOfWork: createUnitOfWork(deps.db),
      channelsTxRepo: {
        upsertChannel: (tx, instanceId, channel) => upsertChannelTx(tx, ownerForDbScope, instanceId, channel),
        listByInstance: (tx, instanceId) => listChannelsByInstanceTx(tx, ownerForDbScope, instanceId),
      },
      channelSecretStore: deps.channelSecretStore,
      listAllowedUsersByOwner: listAllowedUsersByOwner(deps.db, ownerForDbScope),
      listAllowedUsersByInstance: listAllowedUsersByInstance(deps.db, ownerForDbScope),
      setAllowedUsers: setAllowedUsers(deps.db, ownerForDbScope),
      deleteAllowedUsersByInstanceIds: deleteAllowedUsersByInstanceIds(deps.db, ownerForDbScope),
      userDirectory: deps.userDirectory,
    }),
    repo,
    isOwnedInstance: (instanceId) =>
      deps.owner === undefined ? Promise.resolve(true) : repo.isOwnedBy(instanceId, deps.owner),
  };
}
