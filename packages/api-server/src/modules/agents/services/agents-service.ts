import {
  isProtectedAgentEnvName,
  type AgentsService,
  type AgentCreateInput,
  type EgressPreset,
  type AgentUpdateInput,
  type EnvVar,
  type TemplateSpec,
  type ChannelConfig,
  ChannelType,
} from "api-server-api";
import { TRPCError } from "@trpc/server";
import type { AgentsRepository } from "../infrastructure/agents-repository.js";
import {
  assembleAgent,
  type InfraAgent,
} from "../infrastructure/agents-configmap-mappers.js";
import {
  assembleSpecFromTemplate,
  assembleSpecFromImage,
} from "../domain/spec-assembly.js";
import type { KeycloakUserDirectory } from "../infrastructure/keycloak-user-directory.js";
import { isSlackChannelUniqueViolation } from "../infrastructure/channel-bindings-repository.js";
import type { ChannelSecretStore } from "../../channels/infrastructure/channel-secret-store.js";
import { ok, err } from "../../../core/result.js";
import type { UnitOfWork, Tx } from "../../../core/unit-of-work.js";
import { emit, EventType } from "../../../events.js";

/**
 * Port consumed by `create()` to seed `egress_rules` for a brand-new agent
 * (ADR-035). Declared locally so the agents module doesn't import across
 * module boundaries; the egress-rules module's adapter structurally
 * satisfies this shape.
 */
export interface PresetSeeder {
  seed(agentId: string, preset: EgressPreset, decidedBy: string): Promise<void>;
}

/**
 * Cleanup hook invoked after a successful K8s ConfigMap delete. Each
 * registered hook clears its module's per-agent durable state — egress
 * rules, pending approvals, anything else keyed by `agent_id` in
 * Postgres. Best-effort: a single hook failing logs and continues so a
 * partial delete doesn't strand the rest.
 */
export type AgentCleanupHook = (agentId: string) => Promise<void>;

/**
 * Returns a new env list where any platform-managed entries (e.g. PORT) are
 * taken from `current` rather than `incoming`, preventing clients from
 * clobbering template-owned envs.
 */
function preserveProtectedEnvs(
  current: EnvVar[],
  incoming: EnvVar[],
): EnvVar[] {
  const preserved = current.filter((e) => isProtectedAgentEnvName(e.name));
  const user = incoming.filter((e) => !isProtectedAgentEnvName(e.name));
  return [...preserved, ...user];
}

export function createAgentsService(deps: {
  repo: AgentsRepository;
  owner: string | undefined;
  readTemplateSpec: (
    id: string,
  ) => Promise<{ spec: TemplateSpec; isOwned: boolean } | null>;
  /** Seeds egress_rules at create time. Optional so the system-agents
   *  composition (which never creates agents) can omit it. */
  presetSeeder?: PresetSeeder;
  /** Run after a successful K8s delete. Each module that owns per-agent
   *  Postgres state contributes one hook. */
  cleanupHooks?: readonly AgentCleanupHook[];
  // --- Runtime / channels / allowed-users dependencies (formerly Instance) ---
  listChannelsByOwner: () => Promise<Map<string, ChannelConfig[]>>;
  listChannelsByAgent: (agentId: string) => Promise<ChannelConfig[]>;
  upsertChannel: (agentId: string, channel: ChannelConfig) => Promise<void>;
  deleteChannelByType: (agentId: string, type: ChannelType) => Promise<void>;
  deleteChannelsByAgentIds: (agentIds: string[]) => Promise<void>;
  unitOfWork: UnitOfWork;
  channelsTxRepo: {
    upsertChannel: (
      tx: Tx,
      agentId: string,
      channel: ChannelConfig,
    ) => Promise<void>;
    listByAgent: (tx: Tx, agentId: string) => Promise<ChannelConfig[]>;
  };
  channelSecretStore: ChannelSecretStore;
  listAllowedUsersByOwner: () => Promise<Map<string, string[]>>;
  listAllowedUsersByAgent: (agentId: string) => Promise<string[]>;
  setAllowedUsers: (agentId: string, subs: string[]) => Promise<void>;
  deleteAllowedUsersByAgentIds: (agentIds: string[]) => Promise<void>;
  userDirectory: KeycloakUserDirectory;
}): AgentsService {
  async function subsToEmails(subs: string[]): Promise<string[]> {
    if (subs.length === 0) return [];
    const map = await deps.userDirectory.resolveManyBySub(subs);
    return subs.map((s) => map.get(s) ?? s);
  }

  async function emailsToSubs(emails: string[]): Promise<string[]> {
    const resolved = await Promise.all(
      emails.map(async (e) => ({
        email: e,
        sub: await deps.userDirectory.resolveByEmail(e),
      })),
    );
    const missing = resolved.filter((r) => r.sub === null).map((r) => r.email);
    if (missing.length > 0) {
      throw new Error(`User not found in Keycloak: ${missing.join(", ")}`);
    }
    return resolved.map((r) => r.sub!);
  }

  async function project(
    infra: InfraAgent,
  ): Promise<ReturnType<typeof assembleAgent>> {
    const [channels, allowedSubs] = await Promise.all([
      deps.listChannelsByAgent(infra.id),
      deps.listAllowedUsersByAgent(infra.id),
    ]);
    const emails = await subsToEmails(allowedSubs);
    return assembleAgent(infra, channels, emails);
  }

  return {
    async list() {
      const [infraAgents, channelMap, allowedUsersMap] = await Promise.all([
        deps.repo.list(deps.owner),
        deps.listChannelsByOwner(),
        deps.listAllowedUsersByOwner(),
      ]);

      const infraIds = new Set(infraAgents.map((a) => a.id));
      const psqlAgentIds = [
        ...new Set([...channelMap.keys(), ...allowedUsersMap.keys()]),
      ];
      const orphans = psqlAgentIds.filter((id) => !infraIds.has(id));
      if (orphans.length > 0) {
        await Promise.all([
          deps.deleteChannelsByAgentIds(orphans),
          deps.deleteAllowedUsersByAgentIds(orphans),
        ]);
        for (const id of orphans) {
          channelMap.delete(id);
          allowedUsersMap.delete(id);
        }
      }

      const allSubs = [...new Set([...allowedUsersMap.values()].flat())];
      const subEmailMap =
        allSubs.length > 0
          ? await deps.userDirectory.resolveManyBySub(allSubs)
          : new Map<string, string>();

      return infraAgents.map((infra) => {
        const subs = allowedUsersMap.get(infra.id) ?? [];
        const emails = subs.map((s) => subEmailMap.get(s) ?? s);
        return assembleAgent(infra, channelMap.get(infra.id) ?? [], emails);
      });
    },

    async get(id) {
      const infra = await deps.repo.get(id, deps.owner);
      if (!infra) return null;
      return project(infra);
    },

    async create(input: AgentCreateInput) {
      let spec: Record<string, unknown>;
      let templateId: string | undefined;
      if (input.templateId) {
        const tmpl = await deps.readTemplateSpec(input.templateId);
        if (!tmpl || tmpl.isOwned) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `template "${input.templateId}" not found`,
          });
        }
        spec = assembleSpecFromTemplate(input.name, tmpl.spec, {
          description: input.description,
        });
        templateId = input.templateId;
      } else {
        spec = assembleSpecFromImage(input.name, {
          image: input.image,
          description: input.description,
        });
      }
      // Append caller-supplied extras (e.g. envMappings from granted app
      // connections). `preserveProtectedEnvs` ensures PORT is always sourced
      // from the template/defaults, no matter what the caller sends.
      if (input.env?.length) {
        const base = (spec.env as EnvVar[] | undefined) ?? [];
        spec.env = preserveProtectedEnvs(base, [...base, ...input.env]);
      }
      if (input.secretRef !== undefined) spec.secretRef = input.secretRef;
      // Merged Agent starts in the running desired state by default; the
      // user can hibernate explicitly.
      spec.desiredState = spec.desiredState ?? "running";
      const owner = deps.owner ?? "";
      const infra = await deps.repo.create(spec, owner, templateId);

      const emails = input.allowedUserEmails ?? [];
      if (emails.length > 0) {
        const subs = await emailsToSubs(emails);
        await deps.setAllowedUsers(infra.id, subs);
      }

      // Bulk-seed the requested preset (default `trusted`). `none` is a
      // no-op; the trusted host list is captured at boot, so reseeding on
      // retry is idempotent against the lookup index.
      if (deps.presetSeeder) {
        await deps.presetSeeder.seed(
          infra.id,
          input.egressPreset ?? "trusted",
          owner,
        );
      }

      const agent = assembleAgent(infra, [], emails);
      emit({ type: EventType.AgentCreated, agentId: agent.id });
      return agent;
    },

    async update(input: AgentUpdateInput) {
      let env = input.env;
      if (env !== undefined) {
        const current = await deps.repo.get(input.id, deps.owner);
        env = preserveProtectedEnvs(current?.spec.env ?? [], env);
      }
      const patch: Record<string, unknown> = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.description !== undefined)
        patch.description = input.description;
      if (env !== undefined) patch.env = env;
      if (input.secretRef !== undefined) patch.secretRef = input.secretRef;
      const infra = await deps.repo.updateSpec(input.id, deps.owner, patch);
      if (!infra) return null;

      if (input.allowedUserEmails !== undefined) {
        const subs = await emailsToSubs(input.allowedUserEmails);
        await deps.setAllowedUsers(input.id, subs);
      }

      emit({ type: EventType.AgentUpdated, agentId: input.id });
      return project(infra);
    },

    async delete(id) {
      const deleted = await deps.repo.delete(id, deps.owner);
      if (!deleted) return;
      await deps.deleteAllowedUsersByAgentIds([id]);
      // Run cleanup hooks sequentially. Each hook is best-effort: a thrown
      // hook is logged and skipped so a single module's failure doesn't
      // strand the others. The sweeper saga catches anything missed here.
      for (const hook of deps.cleanupHooks ?? []) {
        try {
          await hook(id);
        } catch (err) {
          process.stderr.write(
            `agents.delete cleanup hook failed for ${id}: ${err instanceof Error ? err.message : err}\n`,
          );
        }
      }
      emit({ type: EventType.AgentDeleted, agentId: id });
    },

    async restart(id) {
      const restarted = await deps.repo.restart(id, deps.owner);
      if (restarted) {
        emit({ type: EventType.AgentRestarted, agentId: id });
      }
      return restarted;
    },

    async wake(id) {
      if (deps.owner && !(await deps.repo.isOwnedBy(id, deps.owner)))
        return null;
      const infra = await deps.repo.wake(id);
      if (!infra) return null;
      if (infra.desiredState === "running") {
        emit({ type: EventType.AgentWoken, agentId: id });
      }
      return project(infra);
    },

    async ensureReady(id) {
      if (deps.owner && !(await deps.repo.isOwnedBy(id, deps.owner))) {
        throw new Error(`agent ${id}: not found or not owned`);
      }
      await deps.repo.ensureReady(id);
    },

    async connectSlack(id, slackChannelId) {
      const infra = await deps.repo.get(id, deps.owner);
      if (!infra) return err({ type: "AgentNotFound" });

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
        const channels = await deps.channelsTxRepo.listByAgent(tx, id);
        return ok({ channels });
      });

      if (!txResult.ok) return txResult;

      emit({ type: EventType.SlackConnected, agentId: id, slackChannelId });

      const allowedSubs = await deps.listAllowedUsersByAgent(id);
      const emails = await subsToEmails(allowedSubs);
      return ok(assembleAgent(infra, txResult.value.channels, emails));
    },

    async disconnectSlack(id) {
      const infra = await deps.repo.get(id, deps.owner);
      if (!infra) return null;

      await deps.deleteChannelByType(id, ChannelType.Slack);
      emit({ type: EventType.SlackDisconnected, agentId: id });

      return project(infra);
    },

    async connectTelegram(id, botToken) {
      const infra = await deps.repo.get(id, deps.owner);
      if (!infra) return null;

      await deps.channelSecretStore.storeTelegramToken(id, botToken);
      await deps.upsertChannel(id, { type: ChannelType.Telegram });
      emit({ type: EventType.TelegramConnected, agentId: id });

      return project(infra);
    },

    async disconnectTelegram(id) {
      const infra = await deps.repo.get(id, deps.owner);
      if (!infra) return null;

      await deps.deleteChannelByType(id, ChannelType.Telegram);
      await deps.channelSecretStore.deleteChannelSecret(
        id,
        ChannelType.Telegram,
      );
      emit({ type: EventType.TelegramDisconnected, agentId: id });

      return project(infra);
    },

    async isAllowedUser(agentId, keycloakSub) {
      const subs = await deps.listAllowedUsersByAgent(agentId);
      // Empty list means unrestricted — the UI surfaces this as
      // "any linked Slack user can interact." A non-empty list flips
      // the gate into allow-listed mode.
      if (subs.length === 0) return true;
      return subs.includes(keycloakSub);
    },
  };
}
