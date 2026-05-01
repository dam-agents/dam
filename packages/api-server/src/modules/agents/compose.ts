import type * as k8s from "@kubernetes/client-node";
import type { Db } from "db";
import type { TemplatesService, AgentsService, InstancesService, SchedulesService, SessionsApiService } from "api-server-api";
import { createK8sClient } from "./infrastructure/k8s.js";
import type { ChannelSecretStore } from "../channels/infrastructure/channel-secret-store.js";
import { createTemplatesRepository } from "./infrastructure/templates-repository.js";
import { createAgentsRepository } from "./infrastructure/agents-repository.js";
import { createInstancesRepository } from "./infrastructure/instances-repository.js";
import { createSchedulesRepository } from "./infrastructure/schedules-repository.js";
import {
  listChannelsByOwner, listChannelsByInstance,
  upsertChannel, deleteChannelByType,
  deleteChannelsByInstanceIds,
  upsertChannelTx, listChannelsByInstanceTx,
} from "./infrastructure/channels-repository.js";
import { createUnitOfWork } from "../../core/unit-of-work.js";
import {
  listAllowedUsersByOwner, listAllowedUsersByInstance,
  setAllowedUsers, deleteAllowedUsersByInstanceIds,
} from "./infrastructure/allowed-users-repository.js";
import { listSessionsByInstance, listSessionsByScheduleId, findActiveByScheduleId, deactivateByScheduleId, upsertSession, deleteSession } from "./infrastructure/sessions-repository.js";
import { createTemplatesService } from "./services/templates-service.js";
import { createAgentsService } from "./services/agents-service.js";
import { createInstancesService } from "./services/instances-service.js";
import { createSchedulesService } from "./services/schedules-service.js";
import { createSessionsService } from "./services/sessions-service.js";
import type { KeycloakUserDirectory } from "./infrastructure/keycloak-user-directory.js";
import type { PresetSeeder } from "./services/agents-service.js";

export type { PresetSeeder } from "./services/agents-service.js";

export function composeAgentsModule(
  api: k8s.CoreV1Api,
  namespace: string,
  owner: string,
  db: Db,
  userDirectory: KeycloakUserDirectory,
  channelSecretStore: ChannelSecretStore,
  agentHome: string,
  presetSeeder?: PresetSeeder,
): {
  templates: TemplatesService;
  agents: AgentsService;
  instances: InstancesService;
  schedules: SchedulesService;
  sessions: SessionsApiService;
} {
  const k8s = createK8sClient(api, namespace);
  const templatesRepo = createTemplatesRepository(k8s);
  const agentsRepo = createAgentsRepository(k8s);
  const instancesRepo = createInstancesRepository(k8s);
  const schedulesRepo = createSchedulesRepository(k8s);

  const agents = createAgentsService({
    repo: agentsRepo,
    owner,
    agentHome,
    readTemplateSpec: (id) => templatesRepo.readSpec(id),
    presetSeeder,
  });

  return {
    templates: createTemplatesService({ repo: templatesRepo }),
    agents,
    instances: createInstancesService({
      repo: instancesRepo,
      owner,
      getAgent: (id) => agents.get(id),
      listChannelsByOwner: listChannelsByOwner(db, owner),
      listChannelsByInstance: listChannelsByInstance(db, owner),
      upsertChannel: upsertChannel(db, owner),
      deleteChannelByType: deleteChannelByType(db, owner),
      deleteChannelsByInstanceIds: deleteChannelsByInstanceIds(db, owner),
      unitOfWork: createUnitOfWork(db),
      channelsTxRepo: {
        upsertChannel: (tx, instanceId, channel) => upsertChannelTx(tx, owner, instanceId, channel),
        listByInstance: (tx, instanceId) => listChannelsByInstanceTx(tx, owner, instanceId),
      },
      channelSecretStore,
      listAllowedUsersByOwner: listAllowedUsersByOwner(db, owner),
      listAllowedUsersByInstance: listAllowedUsersByInstance(db, owner),
      setAllowedUsers: setAllowedUsers(db, owner),
      deleteAllowedUsersByInstanceIds: deleteAllowedUsersByInstanceIds(db, owner),
      userDirectory,
    }),
    schedules: createSchedulesService({ repo: schedulesRepo, owner }),
    sessions: createSessionsService({
      listByInstance: listSessionsByInstance(db),
      listByScheduleId: listSessionsByScheduleId(db),
      findActiveByScheduleId: findActiveByScheduleId(db),
      upsert: upsertSession(db),
      delete: deleteSession(db),
      isOwnedInstance: (instanceId) => instancesRepo.isOwnedBy(instanceId, owner),
      isOwnedSchedule: async (scheduleId) => (await schedulesRepo.get(scheduleId, owner)) !== null,
      deactivateByScheduleId: deactivateByScheduleId(db),
      namespace,
    }),
  };
}

export function composeSystemInstances(
  api: k8s.CoreV1Api,
  namespace: string,
  db: Db,
  userDirectory: KeycloakUserDirectory,
  channelSecretStore: ChannelSecretStore,
  agentHome: string,
): InstancesService {
  const k8s = createK8sClient(api, namespace);
  const templatesRepo = createTemplatesRepository(k8s);
  const agentsRepo = createAgentsRepository(k8s);
  const instancesRepo = createInstancesRepository(k8s);

  const agents = createAgentsService({
    repo: agentsRepo,
    owner: "",
    agentHome,
    readTemplateSpec: (id) => templatesRepo.readSpec(id),
  });

  return createInstancesService({
    repo: instancesRepo,
    owner: undefined,
    getAgent: (id) => agents.get(id),
    listChannelsByOwner: listChannelsByOwner(db, ""),
    listChannelsByInstance: listChannelsByInstance(db, ""),
    upsertChannel: upsertChannel(db, ""),
    deleteChannelByType: deleteChannelByType(db, ""),
    deleteChannelsByInstanceIds: deleteChannelsByInstanceIds(db, ""),
    unitOfWork: createUnitOfWork(db),
    channelsTxRepo: {
      upsertChannel: (tx, instanceId, channel) => upsertChannelTx(tx, "", instanceId, channel),
      listByInstance: (tx, instanceId) => listChannelsByInstanceTx(tx, "", instanceId),
    },
    channelSecretStore,
    listAllowedUsersByOwner: listAllowedUsersByOwner(db, ""),
    listAllowedUsersByInstance: listAllowedUsersByInstance(db, ""),
    setAllowedUsers: setAllowedUsers(db, ""),
    deleteAllowedUsersByInstanceIds: deleteAllowedUsersByInstanceIds(db, ""),
    userDirectory,
  });
}
