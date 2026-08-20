import {
  isProtectedAgentEnvName,
  type AgentsService,
  type AgentCreateInput,
  type EgressPreset,
  type AgentUpdateInput,
  type EnvVar,
  type Harness,
  type TemplateSpec,
  type ChannelConfig,
  type DriverFailure,
  type BindTelegramChatResult,
  type BindSlackChannelResult,
  type ConnectSlackResult,
  type ListTelegramChatsResult,
  type UnbindTelegramChatResult,
  type SessionBackgroundWork,
  type TemplateUpdate,
  type UpgradeAgentError,
  ChannelType,
} from "api-server-api";
import { TRPCError } from "@trpc/server";
import type { AgentsRepository } from "../infrastructure/agents-repository.js";
import type { AgentEnvRepository } from "../infrastructure/agent-env-repository.js";
import type { PodStatusClient } from "../infrastructure/pod-status-client.js";
import { minutesToDuration } from "../../../duration.js";
import {
  assembleAgent,
  type InfraAgent,
} from "../infrastructure/agent-mappers.js";
import {
  assembleSpecFromTemplate,
  assembleSpecFromImage,
  resolveEffectiveHibernationTimeoutMin,
  type DefaultResourceLimits,
} from "../domain/spec-assembly.js";
import {
  ANN_AGENT_KIND,
  ANN_HARNESS,
  ANN_KB_TEMPLATE,
  ANN_LIFETIME_MS,
  ANN_SWEEPABLE,
} from "../infrastructure/labels.js";
import {
  seedTelemetryIdentity,
  renamedTelemetryIdentity,
} from "../domain/telemetry-env.js";
import { templateImageUpdate } from "../domain/template-update.js";
import { generateK8sName } from "../infrastructure/configmap-mappers.js";
import type { AgentRegistrySecretPort } from "../infrastructure/agent-registry-secret-port.js";
import { isSlackChannelUniqueViolation } from "../infrastructure/channel-bindings-repository.js";
import type { RuntimeMutator } from "../../runtime-delivery/index.js";
import { ok, err } from "../../../core/result.js";
import type { UnitOfWork, Tx } from "../../../core/unit-of-work.js";
import { emit, EventType } from "../../../events.js";
import { securityLog } from "../../../core/security-log.js";

export interface ContributionsStatus {
  settled: boolean;
  failures: DriverFailure[];
  preparingWorkspace: boolean;
}

export interface ContributionsProgress {
  version: number;
  settled: boolean;
  applied: boolean;
  failures: DriverFailure[];
}

export interface ContributionsProgressPort {
  status(agentId: string): Promise<ContributionsStatus>;
  statusMany(agentIds: string[]): Promise<Map<string, ContributionsStatus>>;
  progress(agentId: string): Promise<ContributionsProgress>;
}

export type RuntimeProgressPort = Pick<ContributionsProgressPort, "progress">;

export interface PresetSeeder {
  seed(agentId: string, preset: EgressPreset, decidedBy: string): Promise<void>;
}

export interface TelegramBindingPort {
  peekFlow(flowId: string): Promise<{
    conversationId: string;
    telegramUserId: string;
    keycloakSub: string;
    chatTitle?: string;
  } | null>;
  consumeFlow(flowId: string): Promise<void>;
  findAgentByConversation(
    conversationId: string,
  ): Promise<{ agentId: string; authorizedBy: string } | null>;
  bind(
    conversationId: string,
    agentId: string,
    authorizedBy: string,
  ): Promise<"bound" | "conflict">;
  postMessage(
    agentId: string,
    conversationId: string,
    text: string,
  ): Promise<{ ok: true } | { error: string }>;
  listConversations(agentId: string): Promise<{ id: string; title: string }[]>;
  unbind(conversationId: string): Promise<void>;
}

export function executeTelegramBind(deps: {
  owner: string | undefined;
  getAgent: (agentId: string) => Promise<{ id: string; name: string } | null>;
  binding: TelegramBindingPort;
}) {
  return async (
    agentId: string,
    flowId: string,
  ): Promise<BindTelegramChatResult> => {
    const flow = await deps.binding.peekFlow(flowId);
    if (!flow) return err({ type: "FlowInvalid" as const });

    if (!deps.owner || flow.keycloakSub !== deps.owner) {
      securityLog("warn", "authz.owner_mismatch", {
        category: "authz",
        actor: deps.owner ?? null,
        actorKind: "user",
        decision: "deny",
        reason: "telegram-bind-sub-mismatch",
        detail: { conversationId: flow.conversationId },
      });
      return err({ type: "FlowInvalid" as const });
    }

    const agent = await deps.getAgent(agentId);
    if (!agent) return err({ type: "AgentNotFound" as const });

    const existing = await deps.binding.findAgentByConversation(
      flow.conversationId,
    );
    if (existing && existing.agentId !== agentId) {
      return err({ type: "ChatAlreadyBound" as const });
    }
    if (!existing) {
      const outcome = await deps.binding.bind(
        flow.conversationId,
        agentId,
        flow.keycloakSub,
      );
      if (outcome === "conflict") {
        const raced = await deps.binding.findAgentByConversation(
          flow.conversationId,
        );
        if (!raced || raced.agentId !== agentId)
          return err({ type: "ChatAlreadyBound" as const });
      }
    }

    await deps.binding.consumeFlow(flowId);

    securityLog("info", "channel.chat_bound", {
      category: "authz-list",
      actor: deps.owner,
      actorKind: "user",
      surface: "telegram",
      agentId,
      result: "success",
      detail: {
        conversationId: flow.conversationId,
        telegramUserId: flow.telegramUserId,
      },
    });

    const post = await deps.binding.postMessage(
      agentId,
      flow.conversationId,
      `This chat is now connected to ${agent.name}. Run the unbind command to disconnect.`,
    );
    if ("error" in post) {
      securityLog("warn", "channel.chat_bound.notify_failed", {
        category: "channel",
        actor: deps.owner,
        actorKind: "user",
        surface: "telegram",
        agentId,
        result: "failure",
        reason: post.error,
        detail: { conversationId: flow.conversationId },
      });
    }

    return ok({ chatTitle: flow.chatTitle ?? null });
  };
}

export function executeBackgroundWorkRead(deps: {
  getAgent: (id: string) => Promise<Pick<InfraAgent, "hibernated"> | null>;
  podStatus: PodStatusClient;
}) {
  return async (id: string): Promise<SessionBackgroundWork[] | null> => {
    const infra = await deps.getAgent(id);
    if (!infra) return null;
    if (infra.hibernated) return [];
    try {
      return await deps.podStatus.backgroundWork(id);
    } catch {
      return [];
    }
  };
}

export function executeTelegramUnbind(deps: {
  owner: string | undefined;
  getAgent: (agentId: string) => Promise<{ id: string; name: string } | null>;
  binding: TelegramBindingPort;
}) {
  return async (
    agentId: string,
    conversationId: string,
  ): Promise<UnbindTelegramChatResult> => {
    const agent = await deps.getAgent(agentId);
    if (!agent) return err({ type: "AgentNotFound" as const });

    const existing = await deps.binding.findAgentByConversation(conversationId);
    if (!existing || existing.agentId !== agentId)
      return err({ type: "ChatNotFound" as const });

    const post = await deps.binding.postMessage(
      agentId,
      conversationId,
      `This chat was disconnected from ${agent.name} by its owner. Run the bind command to connect it again.`,
    );
    if ("error" in post) {
      securityLog("warn", "channel.chat_unbound.notify_failed", {
        category: "channel",
        actor: deps.owner ?? null,
        actorKind: "user",
        surface: "telegram",
        agentId,
        result: "failure",
        reason: post.error,
        detail: { conversationId },
      });
    }

    await deps.binding.unbind(conversationId);
    securityLog("info", "channel.chat_unbound", {
      category: "authz-list",
      actor: deps.owner ?? null,
      actorKind: "user",
      surface: "telegram",
      agentId,
      result: "success",
      detail: { conversationId, viaUi: true },
    });
    return ok(null);
  };
}

export interface SlackBindingPort {
  peekFlow(flowId: string): Promise<{
    slackChannelId: string;
    slackUserId: string;
    keycloakSub: string;
    channelTitle?: string;
  } | null>;
  consumeFlow(flowId: string): Promise<void>;
  postMessage(
    agentId: string,
    slackChannelId: string,
    text: string,
  ): Promise<{ ok: true } | { error: string }>;
}

export function executeSlackBind(deps: {
  owner: string | undefined;
  getAgent: (agentId: string) => Promise<{ id: string; name: string } | null>;
  findChannelBinding: (
    slackChannelId: string,
  ) => Promise<{ agentId: string } | null>;
  connectShared: (
    agentId: string,
    slackChannelId: string,
  ) => Promise<ConnectSlackResult>;
  binding: SlackBindingPort;
}) {
  return async (
    agentId: string,
    flowId: string,
  ): Promise<BindSlackChannelResult> => {
    const flow = await deps.binding.peekFlow(flowId);
    if (!flow) return err({ type: "FlowInvalid" as const });

    if (!deps.owner || flow.keycloakSub !== deps.owner) {
      securityLog("warn", "authz.owner_mismatch", {
        category: "authz",
        actor: deps.owner ?? null,
        actorKind: "user",
        decision: "deny",
        reason: "slack-bind-sub-mismatch",
        detail: { slackChannelId: flow.slackChannelId },
      });
      return err({ type: "FlowInvalid" as const });
    }

    const agent = await deps.getAgent(agentId);
    if (!agent) return err({ type: "AgentNotFound" as const });

    const existing = await deps.findChannelBinding(flow.slackChannelId);
    if (existing) return err({ type: "ChannelAlreadyBound" as const });

    const connected = await deps.connectShared(agentId, flow.slackChannelId);
    if (!connected.ok) {
      return err({ type: "ChannelAlreadyBound" as const });
    }

    await deps.binding.consumeFlow(flowId);

    securityLog("info", "channel.chat_bound", {
      category: "authz-list",
      actor: deps.owner,
      actorKind: "user",
      surface: "slack",
      agentId,
      result: "success",
      detail: {
        slackChannelId: flow.slackChannelId,
        slackUserId: flow.slackUserId,
      },
    });

    const isDm = flow.slackChannelId.startsWith("D");
    const post = await deps.binding.postMessage(
      agentId,
      flow.slackChannelId,
      isDm
        ? `This DM is now connected to ${agent.name}. Message it here; run the unbind command to disconnect.`
        : `This channel is now connected to ${agent.name}. Everyone here can use it; run the unbind command to disconnect.`,
    );
    if ("error" in post) {
      securityLog("warn", "channel.chat_bound.notify_failed", {
        category: "channel",
        actor: deps.owner,
        actorKind: "user",
        surface: "slack",
        agentId,
        result: "failure",
        reason: post.error,
        detail: { slackChannelId: flow.slackChannelId },
      });
    }

    return ok({ channelTitle: flow.channelTitle ?? null });
  };
}

export function executeTemplateUpgrade(deps: {
  owner: string | undefined;
  getAgent: (id: string) => Promise<InfraAgent | null>;
  readTemplateSpec: (
    id: string,
  ) => Promise<{ spec: TemplateSpec; isOwned: boolean } | null>;
  patchImage: (id: string, image: string) => Promise<InfraAgent | null>;
}) {
  return async (
    id: string,
    expectedToImage?: string,
  ): Promise<
    { ok: true; value: InfraAgent } | { ok: false; error: UpgradeAgentError }
  > => {
    const infra = await deps.getAgent(id);
    if (!infra) return err({ type: "AgentNotFound" as const });
    if (!infra.templateId) return err({ type: "TemplateNotFound" as const });
    const tmpl = await deps.readTemplateSpec(infra.templateId);
    if (!tmpl) return err({ type: "TemplateNotFound" as const });

    if (expectedToImage !== undefined && expectedToImage !== tmpl.spec.image)
      return err({ type: "TemplateMoved" as const });

    const update = templateImageUpdate(infra.spec.image, tmpl.spec.image);
    if (!update) return ok(infra);

    const patched = await deps.patchImage(id, update.toImage);
    if (!patched) return err({ type: "AgentNotFound" as const });
    securityLog("info", "agent.upgrade", {
      category: "resource",
      actor: deps.owner ?? null,
      actorKind: "user",
      agentId: id,
      result: "success",
      detail: {
        templateId: infra.templateId,
        fromImage: update.fromImage,
        toImage: update.toImage,
      },
    });
    return ok(patched);
  };
}

export type AgentCleanupHook = (agentId: string) => Promise<void>;

function preserveProtectedEnvs(
  current: EnvVar[],
  incoming: EnvVar[],
): EnvVar[] {
  const preserved = current.filter((e) => isProtectedAgentEnvName(e.name));
  const user = incoming.filter((e) => !isProtectedAgentEnvName(e.name));
  return [...preserved, ...user];
}

function withUserEnv(infra: InfraAgent, env: EnvVar[]): InfraAgent {
  return { ...infra, spec: { ...infra.spec, env } };
}

export interface ResizeGatePort {
  assertResizeFits(
    agent: InfraAgent,
    newSize: { cpu?: string; memory?: string },
  ): Promise<void>;
}

export function createAgentsService(deps: {
  repo: AgentsRepository;
  agentEnvRepo: AgentEnvRepository;
  agentIdleTimeoutMinutes: number;
  owner: string | undefined;
  readTemplateSpec: (
    id: string,
  ) => Promise<{ spec: TemplateSpec; isOwned: boolean } | null>;
  presetSeeder?: PresetSeeder;
  cleanupHooks?: readonly AgentCleanupHook[];
  registrySecretPort: AgentRegistrySecretPort;
  runtimeMutator: RuntimeMutator;
  contributionsProgress: ContributionsProgressPort;
  podStatus: PodStatusClient;
  agentDefaultLimits: DefaultResourceLimits;
  virtualizationEnabled?: boolean;
  resizeGate?: ResizeGatePort;
  resizeLock: <T>(key: string, fn: () => Promise<T>) => Promise<T>;
  grantProvisioner?: {
    resolveSpecGrants(sel: {
      connectionIds: string[];
    }): Promise<{ grantedConnectionIds: string[] }>;
    applyAfterCreate(
      agentId: string,
      sel: { connectionIds: string[] },
    ): Promise<void>;
  };
  listChannelsByOwner: () => Promise<Map<string, ChannelConfig[]>>;
  listChannelsByAgent: (agentId: string) => Promise<ChannelConfig[]>;
  upsertChannel: (agentId: string, channel: ChannelConfig) => Promise<void>;
  deleteChannelByType: (agentId: string, type: ChannelType) => Promise<void>;
  deleteSlackChannelByAgent: (
    agentId: string,
    slackChannelId: string,
  ) => Promise<boolean>;
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
  findSlackChannelBinding: (slackChannelId: string) => Promise<{
    agentId: string;
    ambient?: boolean;
  } | null>;
  telegramBinding?: TelegramBindingPort;
  slackBinding?: SlackBindingPort;
}): AgentsService {
  async function safeStatus(id: string): Promise<ContributionsStatus> {
    try {
      return await deps.contributionsProgress.status(id);
    } catch {
      return { settled: true, failures: [], preparingWorkspace: false };
    }
  }

  async function templateUpdateFor(
    infra: InfraAgent,
  ): Promise<TemplateUpdate | undefined> {
    if (!infra.templateId) return undefined;
    const tmpl = await deps.readTemplateSpec(infra.templateId);
    if (!tmpl) return undefined;
    return templateImageUpdate(infra.spec.image, tmpl.spec.image);
  }

  async function project(
    infra: InfraAgent,
  ): Promise<ReturnType<typeof assembleAgent>> {
    const [channels, status, userEnv, templateUpdate] = await Promise.all([
      deps.listChannelsByAgent(infra.id),
      safeStatus(infra.id),
      deps.agentEnvRepo.list(infra.id),
      templateUpdateFor(infra),
    ]);
    return assembleAgent(
      withUserEnv(infra, userEnv),
      channels,
      status.failures,
      deps.agentIdleTimeoutMinutes,
      status.preparingWorkspace,
      templateUpdate,
    );
  }

  const connectSlackImpl = async (
    id: string,
    slackChannelId: string,
    ambient?: boolean,
  ): Promise<ConnectSlackResult> => {
    const infra = await deps.repo.get(id, deps.owner);
    if (!infra) return err({ type: "AgentNotFound" });

    const existing = await deps.findSlackChannelBinding(slackChannelId);
    if (existing && existing.agentId !== id)
      return err({ type: "ChannelAlreadyBound" as const });

    const requestedAmbient = ambient === true;

    const txResult = await deps.unitOfWork(async (tx) => {
      try {
        await deps.channelsTxRepo.upsertChannel(tx, id, {
          type: ChannelType.Slack,
          slackChannelId,
          ...(requestedAmbient ? { ambient: true } : {}),
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

    emit({
      type: EventType.SlackConnected,
      agentId: id,
      slackChannelId,
    });

    const wasAmbient = existing?.ambient === true;
    if (wasAmbient !== requestedAmbient) {
      securityLog("info", "channel.ambient_toggled", {
        category: "authz-list",
        actor: deps.owner ?? null,
        actorKind: "user",
        surface: "slack",
        agentId: id,
        result: "success",
        detail: { slackChannelId, ambient: requestedAmbient },
      });
    }

    const status = await safeStatus(id);
    return ok(
      assembleAgent(
        infra,
        txResult.value.channels,
        status.failures,
        deps.agentIdleTimeoutMinutes,
        status.preparingWorkspace,
        await templateUpdateFor(infra),
      ),
    );
  };

  return {
    async list() {
      const [infraAgents, channelMap] = await Promise.all([
        deps.repo.list(deps.owner),
        deps.listChannelsByOwner(),
      ]);

      const infraIds = new Set(infraAgents.map((a) => a.id));
      const orphans = [...channelMap.keys()].filter((id) => !infraIds.has(id));
      if (orphans.length > 0) {
        securityLog("warn", "agent.channels.orphan_purge", {
          category: "authz-list",
          actor: deps.owner ?? null,
          actorKind: "user",
          detail: { agentIds: orphans },
        });
        await deps.deleteChannelsByAgentIds(orphans);
        for (const id of orphans) {
          channelMap.delete(id);
        }
      }

      const [failuresMap, envMap] = await Promise.all([
        deps.contributionsProgress
          .statusMany([...infraIds])
          .catch(() => new Map<string, ContributionsStatus>()),
        deps.agentEnvRepo.listMany([...infraIds]),
      ]);

      const templateIds = [
        ...new Set(infraAgents.flatMap((a) => a.templateId ?? [])),
      ];
      const templateImages = new Map<string, string>();
      await Promise.all(
        templateIds.map(async (tid) => {
          const tmpl = await deps.readTemplateSpec(tid);
          if (tmpl) templateImages.set(tid, tmpl.spec.image);
        }),
      );

      return infraAgents.map((infra) => {
        const status = failuresMap.get(infra.id);
        const templateImage = infra.templateId
          ? templateImages.get(infra.templateId)
          : undefined;
        return assembleAgent(
          withUserEnv(infra, envMap.get(infra.id) ?? []),
          channelMap.get(infra.id) ?? [],
          status?.failures ?? [],
          deps.agentIdleTimeoutMinutes,
          status?.preparingWorkspace ?? false,
          templateImage
            ? templateImageUpdate(infra.spec.image, templateImage)
            : undefined,
        );
      });
    },

    async get(id) {
      const infra = await deps.repo.get(id, deps.owner);
      if (!infra) return null;
      return project(infra);
    },

    backgroundWork: executeBackgroundWorkRead({
      getAgent: (id) => deps.repo.get(id, deps.owner),
      podStatus: deps.podStatus,
    }),

    async create(input: AgentCreateInput) {
      let spec: Record<string, unknown>;
      let templateId: string | undefined;
      let harness: Harness = "pod";
      if (input.templateId) {
        const tmpl = await deps.readTemplateSpec(input.templateId);
        if (!tmpl || tmpl.isOwned) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `template "${input.templateId}" not found`,
          });
        }
        spec = assembleSpecFromTemplate(
          input.name,
          tmpl.spec,
          { description: input.description, size: input.size },
          deps.agentDefaultLimits,
        );
        templateId = input.templateId;
        harness = tmpl.spec.harness ?? "pod";
      } else {
        spec = assembleSpecFromImage(
          input.name,
          {
            image: input.image,
            description: input.description,
            size: input.size,
          },
          deps.agentDefaultLimits,
        );
      }
      const backend = spec.backend as { type?: string } | undefined;
      if (backend?.type === "vm" && !deps.virtualizationEnabled) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "this template runs as a full VM, which is not enabled on this install (virtualization.enabled)",
        });
      }
      const templateEnv = seedTelemetryIdentity(
        (spec.env as EnvVar[] | undefined) ?? [],
        input.name,
      );
      delete spec.env;
      if (input.secretRef !== undefined) spec.secretRef = input.secretRef;
      if (input.hibernationTimeoutMin !== undefined)
        spec.hibernationTimeout = minutesToDuration(
          input.hibernationTimeoutMin,
        );
      if (input.telemetryAttributionId !== undefined)
        spec.telemetryAttributionId = input.telemetryAttributionId;

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
      const agentId = input.id ?? generateK8sName("agent");

      if (input.registryCredential) {
        await deps.registrySecretPort.create(
          agentId,
          owner,
          input.registryCredential,
        );
        spec.imagePullSecretRef = deps.registrySecretPort.secretName(agentId);
      }

      const createAnnotations: Record<string, string> = {};
      if (input.sweepable) {
        createAnnotations[ANN_SWEEPABLE] = "true";
        if (input.lifetimeMs && input.lifetimeMs > 0)
          createAnnotations[ANN_LIFETIME_MS] = String(input.lifetimeMs);
      }
      if (input.kind) createAnnotations[ANN_AGENT_KIND] = input.kind;
      if (harness !== "pod") createAnnotations[ANN_HARNESS] = harness;
      if (input.kbTemplateId)
        createAnnotations[ANN_KB_TEMPLATE] = input.kbTemplateId;

      let infra: InfraAgent;
      try {
        infra = await deps.repo.create(
          spec,
          owner,
          agentId,
          templateId,
          Object.keys(createAnnotations).length ? createAnnotations : undefined,
        );
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

      const userEnv = preserveProtectedEnvs(
        [],
        [...templateEnv, ...(input.env ?? [])],
      );
      if (userEnv.length > 0)
        await deps.agentEnvRepo.replace(infra.id, userEnv);

      if (deps.presetSeeder) {
        await deps.presetSeeder.seed(
          infra.id,
          input.egressPreset ?? "trusted",
          owner,
        );
      }

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

      if (deps.grantProvisioner && hasInitialGrants) {
        await deps.grantProvisioner.applyAfterCreate(infra.id, grantSel);
      }

      const agent = assembleAgent(
        withUserEnv(infra, userEnv),
        [],
        [],
        deps.agentIdleTimeoutMinutes,
      );
      securityLog("info", "agent.create", {
        category: "resource",
        actor: owner || null,
        actorKind: "user",
        agentId: agent.id,
        result: "success",
        detail: {
          ...(templateId ? { templateId } : {}),
          egressPreset: input.egressPreset ?? "trusted",
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
      if (input.hibernationTimeoutMin !== undefined)
        patch.hibernationTimeout =
          input.hibernationTimeoutMin === null
            ? null
            : minutesToDuration(input.hibernationTimeoutMin);
      let gateLiveResize:
        | ((
            apply: () => Promise<InfraAgent | null>,
          ) => Promise<InfraAgent | null>)
        | null = null;
      if (input.size !== undefined) {
        gateLiveResize = (apply) =>
          deps.resizeLock(`resize:${deps.owner ?? ""}`, async () => {
            const current = await deps.repo.get(input.id, deps.owner);
            if (!current) return null;
            if (!current.hibernated && !current.overBudget) {
              const gate = deps.resizeGate;
              if (!gate) {
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: "Resizing a running sandbox is not supported here.",
                });
              }
              await gate.assertResizeFits(current, input.size!);
            }
            return apply();
          });
        patch.resources = { limits: input.size };
      }
      const applyPatch = () =>
        Object.keys(patch).length > 0
          ? deps.repo.updateSpec(input.id, deps.owner, patch)
          : deps.repo.get(input.id, deps.owner);
      const infra = gateLiveResize
        ? await gateLiveResize(applyPatch)
        : await applyPatch();
      if (!infra) return null;

      let env = input.env;
      if (env !== undefined) {
        env = preserveProtectedEnvs([], env);
        if (input.name !== undefined)
          env = renamedTelemetryIdentity(env, input.name) ?? env;
        await deps.agentEnvRepo.replace(input.id, env);
        await deps.runtimeMutator.bump(input.id, []);
        await deps.runtimeMutator.enqueueAfterCommit(input.id);
      } else if (input.name !== undefined) {
        const refreshed = renamedTelemetryIdentity(
          await deps.agentEnvRepo.list(input.id),
          input.name,
        );
        if (refreshed) {
          await deps.agentEnvRepo.replace(input.id, refreshed);
          await deps.runtimeMutator.bump(input.id, []);
          await deps.runtimeMutator.enqueueAfterCommit(input.id);
        }
      }

      if (input.env !== undefined || input.secretRef !== undefined) {
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

      emit({ type: EventType.AgentUpdated, agentId: input.id });
      return project(infra);
    },

    async delete(id) {
      const deleted = await deps.repo.delete(id, deps.owner);
      if (!deleted) return;
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

    async stop(id) {
      if (deps.owner && !(await deps.repo.isOwnedBy(id, deps.owner))) {
        securityLog("warn", "authz.owner_mismatch", {
          category: "authz",
          actor: deps.owner,
          actorKind: "user",
          agentId: id,
          decision: "deny",
          reason: "not-owner",
          detail: { surface: "agent.stop" },
        });
        return null;
      }
      const infra = await deps.repo.requestStop(id);
      if (!infra) return null;
      securityLog("info", "agent.stop", {
        category: "privileged",
        actor: deps.owner ?? null,
        actorKind: "user",
        agentId: id,
        result: "success",
      });
      return project(infra);
    },

    async pause(id) {
      if (deps.owner && !(await deps.repo.isOwnedBy(id, deps.owner))) {
        securityLog("warn", "authz.owner_mismatch", {
          category: "authz",
          actor: deps.owner,
          actorKind: "user",
          agentId: id,
          decision: "deny",
          reason: "not-owner",
          detail: { surface: "agent.pause" },
        });
        return null;
      }
      const current = await deps.repo.get(id, deps.owner);
      if (!current) return null;
      const effectiveTimeout = resolveEffectiveHibernationTimeoutMin(
        current.spec.hibernationTimeout,
        deps.agentIdleTimeoutMinutes,
      );
      const infra =
        effectiveTimeout === 0
          ? await deps.repo.requestStop(id)
          : await deps.repo.requestPause(id);
      if (!infra) return null;
      securityLog("info", "agent.pause", {
        category: "privileged",
        actor: deps.owner ?? null,
        actorKind: "user",
        agentId: id,
        result: "success",
      });
      return project(infra);
    },

    async upgrade(id, expectedToImage) {
      const result = await executeTemplateUpgrade({
        owner: deps.owner,
        getAgent: (agentId) => deps.repo.get(agentId, deps.owner),
        readTemplateSpec: deps.readTemplateSpec,
        patchImage: (agentId, image) =>
          deps.repo.updateSpec(agentId, deps.owner, { image }),
      })(id, expectedToImage);
      if (!result.ok) return result;
      emit({ type: EventType.AgentUpdated, agentId: id });
      return ok(await project(result.value));
    },

    async ensureReady(id, opts) {
      if (deps.owner && !(await deps.repo.isOwnedBy(id, deps.owner))) {
        throw new Error(`agent ${id}: not found or not owned`);
      }
      await deps.repo.ensureReady(id, opts);
    },

    async connectSlack(id, slackChannelId, ambient) {
      return connectSlackImpl(id, slackChannelId, ambient);
    },

    async disconnectSlack(id, slackChannelId) {
      const infra = await deps.repo.get(id, deps.owner);
      if (!infra) return null;

      if (slackChannelId === undefined) {
        await deps.deleteChannelByType(id, ChannelType.Slack);
        emit({ type: EventType.SlackDisconnected, agentId: id });
        return project(infra);
      }

      const released = await deps.deleteSlackChannelByAgent(id, slackChannelId);
      if (released) {
        emit({
          type: EventType.SlackDisconnected,
          agentId: id,
          slackChannelId,
        });
      }
      return project(infra);
    },

    async listTelegramChats(agentId) {
      const binding = deps.telegramBinding;
      if (!binding) return err({ type: "TelegramUnavailable" as const });
      const infra = await deps.repo.get(agentId, deps.owner);
      if (!infra) return err({ type: "AgentNotFound" as const });
      const chats = await binding.listConversations(infra.id);
      return ok({
        chats: chats.map((c) => ({ conversationId: c.id, title: c.title })),
      });
    },

    async unbindTelegramChat(agentId, conversationId) {
      const binding = deps.telegramBinding;
      if (!binding) return err({ type: "ChatNotFound" as const });
      return executeTelegramUnbind({
        owner: deps.owner,
        getAgent: async (id) => {
          const infra = await deps.repo.get(id, deps.owner);
          return infra ? { id: infra.id, name: infra.name } : null;
        },
        binding,
      })(agentId, conversationId);
    },

    async bindTelegramChat(agentId, flowId) {
      const binding = deps.telegramBinding;
      if (!binding) return err({ type: "FlowInvalid" as const });
      return executeTelegramBind({
        owner: deps.owner,
        getAgent: async (id) => {
          const infra = await deps.repo.get(id, deps.owner);
          return infra ? { id: infra.id, name: infra.name } : null;
        },
        binding,
      })(agentId, flowId);
    },

    async bindSlackChannel(agentId, flowId) {
      const binding = deps.slackBinding;
      if (!binding) return err({ type: "FlowInvalid" as const });
      return executeSlackBind({
        owner: deps.owner,
        getAgent: async (id) => {
          const infra = await deps.repo.get(id, deps.owner);
          return infra ? { id: infra.id, name: infra.name } : null;
        },
        findChannelBinding: deps.findSlackChannelBinding,
        connectShared: (id, slackChannelId) =>
          connectSlackImpl(id, slackChannelId),
        binding,
      })(agentId, flowId);
    },
  };
}
