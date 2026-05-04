import type {
  InstancesService,
  CreateInstanceInput,
  UpdateInstanceInput,
  ChannelConfig,
  Agent,
} from "api-server-api";
import { SPEC_VERSION, ChannelType } from "api-server-api";
import type { InstancesRepository } from "./../infrastructure/instances-repository.js";
import type { KeycloakUserDirectory } from "./../infrastructure/keycloak-user-directory.js";
import type { ChannelSecretStore } from "../../channels/infrastructure/channel-secret-store.js";
import { assembleInstance, findOrphanedInstanceIds } from "../domain/instance-assembly.js";
import { isSlackChannelUniqueViolation } from "../infrastructure/channels-repository.js";
import { ok, err } from "../../../core/result.js";
import type { UnitOfWork, Tx } from "../../../core/unit-of-work.js";
import { emit, EventType } from "../../../events.js";

export function createInstancesService(deps: {
  repo: InstancesRepository;
  owner: string | undefined;
  getAgent: (id: string) => Promise<Agent | null>;
  listChannelsByOwner: () => Promise<Map<string, ChannelConfig[]>>;
  listChannelsByInstance: (instanceId: string) => Promise<ChannelConfig[]>;
  upsertChannel: (instanceId: string, channel: ChannelConfig) => Promise<void>;
  deleteChannelByType: (instanceId: string, type: ChannelType) => Promise<void>;
  unitOfWork: UnitOfWork;
  channelsTxRepo: {
    upsertChannel: (tx: Tx, instanceId: string, channel: ChannelConfig) => Promise<void>;
    listByInstance: (tx: Tx, instanceId: string) => Promise<ChannelConfig[]>;
  };
  deleteChannelsByInstanceIds: (instanceIds: string[]) => Promise<void>;
  channelSecretStore: ChannelSecretStore;
  listAllowedUsersByOwner: () => Promise<Map<string, string[]>>;
  listAllowedUsersByInstance: (instanceId: string) => Promise<string[]>;
  setAllowedUsers: (instanceId: string, subs: string[]) => Promise<void>;
  deleteAllowedUsersByInstanceIds: (instanceIds: string[]) => Promise<void>;
  userDirectory: KeycloakUserDirectory;
}): InstancesService {
  async function subsToEmails(subs: string[]): Promise<string[]> {
    if (subs.length === 0) return [];
    const map = await deps.userDirectory.resolveManyBySub(subs);
    return subs.map((s) => map.get(s) ?? s);
  }

  async function emailsToSubs(emails: string[]): Promise<string[]> {
    const resolved = await Promise.all(
      emails.map(async (e) => ({ email: e, sub: await deps.userDirectory.resolveByEmail(e) })),
    );
    const missing = resolved.filter((r) => r.sub === null).map((r) => r.email);
    if (missing.length > 0) {
      throw new Error(`User not found in Keycloak: ${missing.join(", ")}`);
    }
    return resolved.map((r) => r.sub!);
  }

  return {
    async list() {
      const [infraInstances, channelMap, allowedUsersMap] = await Promise.all([
        deps.repo.list(deps.owner),
        deps.listChannelsByOwner(),
        deps.listAllowedUsersByOwner(),
      ]);

      const infraIds = new Set(infraInstances.map((i) => i.id));
      const psqlInstanceIds = [...new Set([...channelMap.keys(), ...allowedUsersMap.keys()])];
      const orphans = findOrphanedInstanceIds(infraIds, psqlInstanceIds);
      if (orphans.length > 0) {
        await Promise.all([
          deps.deleteChannelsByInstanceIds(orphans),
          deps.deleteAllowedUsersByInstanceIds(orphans),
        ]);
        for (const id of orphans) {
          channelMap.delete(id);
          allowedUsersMap.delete(id);
        }
      }

      const allSubs = [...new Set([...allowedUsersMap.values()].flat())];
      const subEmailMap = allSubs.length > 0
        ? await deps.userDirectory.resolveManyBySub(allSubs)
        : new Map<string, string>();

      return infraInstances.map((infra) => {
        const subs = allowedUsersMap.get(infra.id) ?? [];
        const emails = subs.map((s) => subEmailMap.get(s) ?? s);
        return assembleInstance(infra, channelMap.get(infra.id) ?? [], emails);
      });
    },

    async get(id) {
      const [infra, channels, allowedSubs] = await Promise.all([
        deps.repo.get(id, deps.owner),
        deps.listChannelsByInstance(id),
        deps.listAllowedUsersByInstance(id),
      ]);
      if (!infra) return null;
      const emails = await subsToEmails(allowedSubs);
      return assembleInstance(infra, channels, emails);
    },

    async create(input: CreateInstanceInput) {
      const agent = await deps.getAgent(input.agentId);
      if (!agent) throw new Error(`Agent "${input.agentId}" not found`);

      const spec = {
        name: input.name,
        version: SPEC_VERSION,
        agentId: input.agentId,
        desiredState: "running" as const,
        env: input.env,
        secretRef: input.secretRef,
        description: input.description,
      };
      const infra = await deps.repo.create(input.agentId, spec, deps.owner ?? "");
      const emails = input.allowedUserEmails ?? [];
      if (emails.length > 0) {
        const subs = await emailsToSubs(emails);
        await deps.setAllowedUsers(infra.id, subs);
      }
      const instance = assembleInstance(infra, [], emails);

      emit({ type: EventType.InstanceCreated, instanceId: instance.id, agentId: input.agentId });
      return instance;
    },

    async update(input: UpdateInstanceInput) {
      const infra = await deps.repo.updateSpec(input.id, deps.owner, {
        env: input.env,
        secretRef: input.secretRef,
      });
      if (!infra) return null;
      if (input.allowedUserEmails !== undefined) {
        const subs = await emailsToSubs(input.allowedUserEmails);
        await deps.setAllowedUsers(input.id, subs);
      }
      const [channels, allowedSubs] = await Promise.all([
        deps.listChannelsByInstance(input.id),
        deps.listAllowedUsersByInstance(input.id),
      ]);
      const emails = await subsToEmails(allowedSubs);
      const instance = assembleInstance(infra, channels, emails);

      emit({ type: EventType.InstanceUpdated, instanceId: input.id });
      return instance;
    },

    async wake(id) {
      if (deps.owner && !await deps.repo.isOwnedBy(id, deps.owner)) return null;
      const infra = await deps.repo.wake(id);
      if (!infra) return null;
      const [channels, allowedSubs] = await Promise.all([
        deps.listChannelsByInstance(id),
        deps.listAllowedUsersByInstance(id),
      ]);
      const emails = await subsToEmails(allowedSubs);
      const instance = assembleInstance(infra, channels, emails);

      if (infra.desiredState === "running") {
        emit({ type: EventType.InstanceWoken, instanceId: id });
      }
      return instance;
    },

    async connectSlack(id, slackChannelId) {
      const infra = await deps.repo.get(id, deps.owner);
      if (!infra) return err({ type: "InstanceNotFound" });

      const txResult = await deps.unitOfWork(async (tx) => {
        try {
          await deps.channelsTxRepo.upsertChannel(tx, id, {
            type: ChannelType.Slack,
            slackChannelId,
          });
        } catch (e) {
          if (isSlackChannelUniqueViolation(e)) {
            return err({ type: "ChannelAlreadyBound" as const });
          }
          throw e;
        }
        const channels = await deps.channelsTxRepo.listByInstance(tx, id);
        return ok({ channels });
      });

      if (!txResult.ok) return txResult;

      emit({ type: EventType.SlackConnected, instanceId: id, slackChannelId });

      const allowedSubs = await deps.listAllowedUsersByInstance(id);
      const emails = await subsToEmails(allowedSubs);
      return ok(assembleInstance(infra, txResult.value.channels, emails));
    },

    async disconnectSlack(id) {
      const infra = await deps.repo.get(id, deps.owner);
      if (!infra) return null;

      await deps.deleteChannelByType(id, ChannelType.Slack);
      emit({ type: EventType.SlackDisconnected, instanceId: id });

      const [channels, allowedSubs] = await Promise.all([
        deps.listChannelsByInstance(id),
        deps.listAllowedUsersByInstance(id),
      ]);
      const emails = await subsToEmails(allowedSubs);
      return assembleInstance(infra, channels, emails);
    },

    async connectTelegram(id, botToken) {
      const infra = await deps.repo.get(id, deps.owner);
      if (!infra) return null;

      await deps.channelSecretStore.storeTelegramToken(id, botToken);
      await deps.upsertChannel(id, { type: ChannelType.Telegram });
      emit({ type: EventType.TelegramConnected, instanceId: id });

      const [channels, allowedSubs] = await Promise.all([
        deps.listChannelsByInstance(id),
        deps.listAllowedUsersByInstance(id),
      ]);
      const emails = await subsToEmails(allowedSubs);
      return assembleInstance(infra, channels, emails);
    },

    async disconnectTelegram(id) {
      const infra = await deps.repo.get(id, deps.owner);
      if (!infra) return null;

      await deps.deleteChannelByType(id, ChannelType.Telegram);
      await deps.channelSecretStore.deleteChannelSecret(id, ChannelType.Telegram);
      emit({ type: EventType.TelegramDisconnected, instanceId: id });

      const [channels, allowedSubs] = await Promise.all([
        deps.listChannelsByInstance(id),
        deps.listAllowedUsersByInstance(id),
      ]);
      const emails = await subsToEmails(allowedSubs);
      return assembleInstance(infra, channels, emails);
    },

    async delete(id) {
      const deleted = await deps.repo.delete(id, deps.owner);
      if (deleted) {
        await deps.deleteAllowedUsersByInstanceIds([id]);
        emit({ type: EventType.InstanceDeleted, instanceId: id });
      }
    },

    async isAllowedUser(instanceId, keycloakSub) {
      const subs = await deps.listAllowedUsersByInstance(instanceId);
      return subs.includes(keycloakSub);
    },

    async restart(id) {
      const restarted = await deps.repo.restart(id, deps.owner);
      if (restarted) {
        emit({ type: EventType.InstanceRestarted, instanceId: id });
      }
      return restarted;
    },

    async ensureReady(id) {
      if (deps.owner && !await deps.repo.isOwnedBy(id, deps.owner)) {
        throw new Error(`instance ${id}: not found or not owned`);
      }
      await deps.repo.ensureReady(id);
    },
  };
}
