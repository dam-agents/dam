import {
  isProtectedAgentEnvName,
  type AgentsService,
  type AgentCreateInput,
  type EgressPreset,
  type AgentUpdateInput,
  type EnvVar,
  type TemplateSpec,
  type ChannelConfig,
  type DriverFailure,
  ChannelType,
} from "api-server-api";
import { TRPCError } from "@trpc/server";
import type { AgentsRepository } from "../infrastructure/agents-repository.js";
import type { AgentEnvRepository } from "../infrastructure/agent-env-repository.js";
import { minutesToDuration } from "../../../duration.js";

/** Outbox-derived contribution status, supplied by runtime-delivery. */
export interface ContributionsStatus {
  settled: boolean;
  failures: DriverFailure[];
  preparingWorkspace: boolean;
}

/** Port: the failed contributions surfaced on an agent (the degraded badge). */
export interface ContributionsSettledPort {
  status(agentId: string): Promise<ContributionsStatus>;
  statusMany(agentIds: string[]): Promise<Map<string, ContributionsStatus>>;
}
import {
  assembleAgent,
  type InfraAgent,
} from "../infrastructure/agent-mappers.js";
import {
  assembleSpecFromTemplate,
  assembleSpecFromImage,
} from "../domain/spec-assembly.js";
import { generateK8sName } from "../infrastructure/configmap-mappers.js";
import type { AgentRegistrySecretPort } from "../infrastructure/agent-registry-secret-port.js";
import type { KeycloakUserDirectory } from "../infrastructure/keycloak-user-directory.js";
import { isSlackChannelUniqueViolation } from "../infrastructure/channel-bindings-repository.js";
import type { ChannelSecretStore } from "../../channels/infrastructure/channel-secret-store.js";
import type { RuntimeMutator } from "../../runtime-delivery/index.js";
import { ok, err } from "../../../core/result.js";
import type { UnitOfWork, Tx } from "../../../core/unit-of-work.js";
import { emit, EventType } from "../../../events.js";
import { securityLog } from "../../../core/security-log.js";

/**
 * Port consumed by `create()` to seed `egress_rules` for a brand-new agent.
 * Declared locally so the agents module doesn't import across
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

/** Feed the view's `spec.env` from the store (the CR no longer carries user env). */
function withUserEnv(infra: InfraAgent, env: EnvVar[]): InfraAgent {
  return { ...infra, spec: { ...infra.spec, env } };
}

export function createAgentsService(deps: {
  repo: AgentsRepository;
  /** Postgres store for user-typed env. */
  agentEnvRepo: AgentEnvRepository;
  /** Global default idle timeout in minutes; resolves a per-agent override into the effective value. */
  agentIdleTimeoutMinutes: number;
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
  registrySecretPort: AgentRegistrySecretPort;
  runtimeMutator: RuntimeMutator;
  contributionsSettled: ContributionsSettledPort;
  /** Single-shot create: seeds spec grant fields before first render, then
   *  applies egress/DB/delivery side-effects. Omitted by system compositions. */
  grantProvisioner?: {
    resolveSpecGrants(sel: {
      connectionIds: string[];
    }): Promise<{ grantedConnectionIds: string[] }>;
    applyAfterCreate(
      agentId: string,
      sel: { connectionIds: string[] },
    ): Promise<void>;
  };
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
  /** The Agent (if any) a Slack channel id is already bound to — global, since
   *  Slack bindings are unique across the whole install. */
  findSlackChannelBinding: (
    slackChannelId: string,
  ) => Promise<{ agentId: string } | null>;
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
      // Bad input, not a server fault — surface as BAD_REQUEST so clients
      // (CLI/UI) can report it as an input error rather than a 500.
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `User not found: ${missing.join(", ")}`,
      });
    }
    return resolved.map((r) => r.sub!);
  }

  // Fail-soft: a transient outbox-DB error must never 500 an agent read.
  async function safeStatus(id: string): Promise<ContributionsStatus> {
    try {
      return await deps.contributionsSettled.status(id);
    } catch {
      return { settled: true, failures: [], preparingWorkspace: false };
    }
  }

  async function project(
    infra: InfraAgent,
  ): Promise<ReturnType<typeof assembleAgent>> {
    const [channels, allowedSubs, status, userEnv] = await Promise.all([
      deps.listChannelsByAgent(infra.id),
      deps.listAllowedUsersByAgent(infra.id),
      safeStatus(infra.id),
      deps.agentEnvRepo.list(infra.id),
    ]);
    const emails = await subsToEmails(allowedSubs);
    return assembleAgent(
      withUserEnv(infra, userEnv),
      channels,
      emails,
      status.failures,
      deps.agentIdleTimeoutMinutes,
      status.preparingWorkspace,
    );
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
        // Clearing an authorization list as a side-effect of a read — flag it
        // so a transient K8s read returning empty can't silently mass-purge.
        securityLog("warn", "agent.allowed_users.orphan_purge", {
          category: "authz-list",
          actor: deps.owner ?? null,
          actorKind: "user",
          detail: { agentIds: orphans },
        });
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

      const [failuresMap, envMap] = await Promise.all([
        deps.contributionsSettled
          .statusMany([...infraIds])
          .catch(() => new Map<string, ContributionsStatus>()),
        deps.agentEnvRepo.listMany([...infraIds]),
      ]);

      return infraAgents.map((infra) => {
        const subs = allowedUsersMap.get(infra.id) ?? [];
        const emails = subs.map((s) => subEmailMap.get(s) ?? s);
        const status = failuresMap.get(infra.id);
        return assembleAgent(
          withUserEnv(infra, envMap.get(infra.id) ?? []),
          channelMap.get(infra.id) ?? [],
          emails,
          status?.failures ?? [],
          deps.agentIdleTimeoutMinutes,
          status?.preparingWorkspace ?? false,
        );
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
      // Template-declared env rides the rail like user env (seeded below), not
      // the CR — the controller no longer reads spec.env.
      const templateEnv = (spec.env as EnvVar[] | undefined) ?? [];
      delete spec.env;
      if (input.secretRef !== undefined) spec.secretRef = input.secretRef;
      if (input.hibernationTimeoutMin !== undefined)
        spec.hibernationTimeout = minutesToDuration(
          input.hibernationTimeoutMin,
        );

      // Single-shot create: seed grants into the spec before first render so
      // credentials ride the first snapshot and the gateway renders its chains
      // once. (Not the roll fix — the agent template is grant-independent.)
      const grantSel = { connectionIds: input.connectionIds ?? [] };
      const hasInitialGrants = grantSel.connectionIds.length > 0;
      if (deps.grantProvisioner && hasInitialGrants) {
        const g = await deps.grantProvisioner.resolveSpecGrants(grantSel);
        if (g.grantedConnectionIds.length)
          spec.grantedConnectionIds = g.grantedConnectionIds;
      }

      if (deps.owner === undefined) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "creating an agent requires an owner",
        });
      }
      const owner = deps.owner;
      const agentId = generateK8sName("agent");

      if (input.registryCredential) {
        await deps.registrySecretPort.create(
          agentId,
          owner,
          input.registryCredential,
        );
        spec.imagePullSecretRef = deps.registrySecretPort.secretName(agentId);
      }

      // No desiredState — a freshly-created agent runs (recent
      // activity), and the idle checker hibernates it once it goes quiet.
      let infra: InfraAgent;
      try {
        infra = await deps.repo.create(spec, owner, agentId, templateId);
      } catch (e) {
        if (input.registryCredential) {
          try {
            await deps.registrySecretPort.delete(agentId);
          } catch (cleanupErr) {
            securityLog("error", "agent.create.pull_secret_orphaned", {
              category: "resource",
              actor: owner || null,
              actorKind: "user",
              result: "failure",
              reason:
                cleanupErr instanceof Error ? cleanupErr.message : "unknown",
            });
          }
        }
        throw e;
      }

      // Input is ordered last so user env wins over a same-named template default (replace dedupes last-wins).
      const userEnv = preserveProtectedEnvs(
        [],
        [...templateEnv, ...(input.env ?? [])],
      );
      if (userEnv.length > 0)
        await deps.agentEnvRepo.replace(infra.id, userEnv);

      const emails = input.allowedUserEmails ?? [];
      if (emails.length > 0) {
        const subs = await emailsToSubs(emails);
        await deps.setAllowedUsers(infra.id, subs);
        securityLog("info", "agent.allowed_users_set", {
          category: "authz-list",
          actor: owner || null,
          actorKind: "user",
          agentId: infra.id,
          result: "success",
          detail: { added: subs, removed: [], resultUnrestricted: false },
        });
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

      // Bump so the built-in platform connection ships from creation (#421).
      // When a git repo was chosen, also enqueue a one-shot `workspace-seed`
      // event — the agent clones it into the work dir on its first apply.
      await deps.runtimeMutator.bump(
        infra.id,
        input.gitRepo
          ? [
              {
                id: `workspace-seed:${infra.id}:${Date.now()}`,
                kind: "workspace-seed",
                payload: { url: input.gitRepo.url, ref: input.gitRepo.ref },
                expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
              },
            ]
          : [],
      );

      // Side-effects now the CR exists: egress sync, connection-grant rows,
      // channel delivery. Re-states the seeded grants (idempotent, no roll).
      if (deps.grantProvisioner && hasInitialGrants) {
        await deps.grantProvisioner.applyAfterCreate(infra.id, grantSel);
      }

      const agent = assembleAgent(
        withUserEnv(infra, userEnv),
        [],
        emails,
        [],
        deps.agentIdleTimeoutMinutes,
      );
      // Records the agent's initial security posture (preset, secret ref,
      // allow-list size, env key names — never env values).
      securityLog("info", "agent.create", {
        category: "resource",
        actor: owner || null,
        actorKind: "user",
        agentId: agent.id,
        result: "success",
        detail: {
          ...(templateId ? { templateId } : {}),
          egressPreset: input.egressPreset ?? "trusted",
          allowedUserCount: emails.length,
          secretRefSet: input.secretRef !== undefined,
          registryCredentialSet: input.registryCredential !== undefined,
          envKeys: (input.env ?? []).map((e) => e.name),
        },
      });
      emit({
        type: EventType.AgentCreated,
        agentId: agent.id,
        ownerSub: owner,
      });
      return agent;
    },

    async update(input: AgentUpdateInput) {
      const patch: Record<string, unknown> = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.description !== undefined)
        patch.description = input.description;
      if (input.secretRef !== undefined) patch.secretRef = input.secretRef;
      // null clears the override (merge-patch deletes the key → inherit the global default).
      if (input.hibernationTimeoutMin !== undefined)
        patch.hibernationTimeout =
          input.hibernationTimeoutMin === null
            ? null
            : minutesToDuration(input.hibernationTimeoutMin);
      // Both branches do the owner check; an env-only update skips the no-op CR patch.
      const infra =
        Object.keys(patch).length > 0
          ? await deps.repo.updateSpec(input.id, deps.owner, patch)
          : await deps.repo.get(input.id, deps.owner);
      if (!infra) return null;

      let env = input.env;
      if (env !== undefined) {
        // Strip protected names, then bump + enqueue so a running agent applies it next turn.
        env = preserveProtectedEnvs([], env);
        await deps.agentEnvRepo.replace(input.id, env);
        await deps.runtimeMutator.bump(input.id, []);
        await deps.runtimeMutator.enqueueAfterCommit(input.id);
      }

      if (input.env !== undefined || input.secretRef !== undefined) {
        // Env and secretRef control what credentials the pod receives — log
        // key names only, never values.
        securityLog("info", "agent.update", {
          category: "resource",
          actor: deps.owner ?? null,
          actorKind: "user",
          agentId: input.id,
          result: "success",
          detail: {
            secretRefChanged: input.secretRef !== undefined,
            ...(env !== undefined ? { envKeys: env.map((e) => e.name) } : {}),
          },
        });
      }

      if (input.allowedUserEmails !== undefined) {
        // Diff against the prior list so an attacker silently inserting their
        // own sub (or emptying the list to make it unrestricted) is visible.
        const prior = await deps.listAllowedUsersByAgent(input.id);
        const subs = await emailsToSubs(input.allowedUserEmails);
        const priorSet = new Set(prior);
        const nextSet = new Set(subs);
        await deps.setAllowedUsers(input.id, subs);
        securityLog("info", "agent.allowed_users_set", {
          category: "authz-list",
          actor: deps.owner ?? null,
          actorKind: "user",
          agentId: input.id,
          result: "success",
          detail: {
            added: subs.filter((s) => !priorSet.has(s)),
            removed: prior.filter((s) => !nextSet.has(s)),
            resultUnrestricted: subs.length === 0,
          },
        });
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
          securityLog("warn", "agent.delete.cleanup_failed", {
            category: "resource",
            actor: deps.owner ?? null,
            actorKind: "user",
            agentId: id,
            result: "failure",
            reason: err instanceof Error ? err.message : "unknown",
          });
        }
      }
      // Destructive (cascades PVC/secret/egress-rule cleanup); the actor is
      // absent from the AgentDeleted event, so log it here.
      securityLog("info", "agent.delete", {
        category: "resource",
        actor: deps.owner ?? null,
        actorKind: "user",
        agentId: id,
        result: "success",
      });
      emit({ type: EventType.AgentDeleted, agentId: id });
    },

    async restart(id) {
      const restarted = await deps.repo.restart(id, deps.owner);
      if (restarted) {
        securityLog("info", "agent.restart", {
          category: "privileged",
          actor: deps.owner ?? null,
          actorKind: "user",
          agentId: id,
          result: "success",
        });
        emit({ type: EventType.AgentRestarted, agentId: id });
      }
      return restarted;
    },

    async wake(id) {
      if (deps.owner && !(await deps.repo.isOwnedBy(id, deps.owner))) {
        securityLog("warn", "authz.owner_mismatch", {
          category: "authz",
          actor: deps.owner,
          actorKind: "user",
          agentId: id,
          decision: "deny",
          reason: "not-owner",
          detail: { surface: "agent.wake" },
        });
        return null;
      }
      const infra = await deps.repo.wake(id);
      if (!infra) return null;
      // Wake is an unconditional activity poke; the reconciler scales
      // the pair up in response.
      securityLog("info", "agent.wake", {
        category: "privileged",
        actor: deps.owner ?? null,
        actorKind: "user",
        agentId: id,
        result: "success",
      });
      emit({ type: EventType.AgentWoken, agentId: id });
      return project(infra);
    },

    async ensureReady(id, opts) {
      if (deps.owner && !(await deps.repo.isOwnedBy(id, deps.owner))) {
        throw new Error(`agent ${id}: not found or not owned`);
      }
      await deps.repo.ensureReady(id, opts);
    },

    async connectSlack(id, slackChannelId) {
      const infra = await deps.repo.get(id, deps.owner);
      if (!infra) return err({ type: "AgentNotFound" });

      // One Slack channel binds to one Agent globally. Pre-check rather than
      // relying on the unique-index violation: catching it inside the
      // transaction below doesn't work — the aborted tx rethrows the raw error
      // as it unwinds — so a channel bound to a different Agent would otherwise
      // surface as a generic 500 instead of ChannelAlreadyBound. The in-tx
      // catch stays as a backstop for the (accepted) concurrent-connect race.
      const existing = await deps.findSlackChannelBinding(slackChannelId);
      if (existing && existing.agentId !== id)
        return err({ type: "ChannelAlreadyBound" as const });

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
      const status = await safeStatus(id);
      return ok(
        assembleAgent(
          infra,
          txResult.value.channels,
          emails,
          status.failures,
          deps.agentIdleTimeoutMinutes,
          status.preparingWorkspace,
        ),
      );
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
