import { avatarCharacter } from "api-server-api/avatar/svg";
import {
  DEFAULT_TEMPLATE_ID,
  RETIRED_TEMPLATE_HARNESS,
} from "../../templates/index.js";
import {
  isProtectedAgentEnvName,
  type Agent,
  type AgentsService,
  type AgentWithAccess,
  type AgentCreateInput,
  type EgressPreset,
  type AgentUpdateInput,
  type EnvVar,
  type ChannelConfig,
  type SlackConversationLabel,
  type SlackLoopGuardDrops,
  type ContributionKind,
  type DriverFailure,
  type WorkspaceFailure,
  type OnboardingStep,
  type WorkspaceMutationKind,
  type BindTelegramChatResult,
  type BindSlackChannelResult,
  type ConnectSlackResult,
  type UnbindTelegramChatResult,
  type AgentBackgroundWork,
  type RuntimeFleetAgent,
  type TemplateUpdate,
  type UpgradeAgentError,
  ChannelType,
} from "api-server-api";
import { TRPCError } from "@trpc/server";
import { match } from "ts-pattern";
import type { AgentsRepository } from "../infrastructure/agents-repository.js";
import type { AgentEnvRepository } from "../infrastructure/agent-env-repository.js";
import type { AgentServiceStatusClient } from "../infrastructure/agent-service-status-client.js";
import type { AgentEditorsRepository } from "../infrastructure/agent-editors-repository.js";
import { accessTo, namesOwner } from "../domain/agent-access.js";
import { minutesToDuration } from "../../../duration.js";
import { getLogger } from "../../../core/logger.js";
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
  ANN_KB_SHARE_ROOTS,
  ANN_LIFETIME_MS,
  ANN_SWEEPABLE,
  ANN_STARTER_KIT,
  ANN_STARTER_KIT_DEFAULT_MODEL,
  ANN_STARTER_KIT_SEED,
} from "../infrastructure/labels.js";
import {
  seedTelemetryIdentity,
  renamedTelemetryIdentity,
} from "../domain/telemetry-env.js";
import {
  isTelegramDirectConversation,
  telegramChatOf,
} from "../domain/telegram-conversation.js";
import { templateImageUpdate } from "../domain/template-update.js";
import { generateK8sName } from "../infrastructure/configmap-mappers.js";
import type { AgentRegistrySecretPort } from "../infrastructure/agent-registry-secret-port.js";
import type { AgentSecretRefPort } from "../infrastructure/agent-secret-ref-port.js";
import { isSlackChannelUniqueViolation } from "../infrastructure/channel-bindings-repository.js";
import {
  type RuntimeMutator,
  agentInstructionsEvent,
  workspaceSeedEvent,
} from "../../runtime-delivery/index.js";
import {
  AGENT_INSTRUCTIONS_TEMPLATE,
  seedsAgentInstructions,
} from "../domain/agent-instructions.js";
import type { ReadTemplateSpec } from "../../templates/index.js";
import { ok, err } from "../../../core/result.js";
import { runtimeFeaturesOf, type RuntimeFeatures } from "agent-runtime-api";
import type { UnitOfWork, Tx } from "../../../core/unit-of-work.js";
import { emit, EventType } from "../../../events.js";
import { securityLog } from "../../../core/security-log.js";

export interface ContributionsStatus {
  settled: boolean;
  failures: DriverFailure[];
  preparingWorkspace: boolean;
  workspaceFailures: WorkspaceFailure[];
  features: RuntimeFeatures;
  unsupportedKinds: ContributionKind[];
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
  retryWorkspaceMutation(
    agentId: string,
    kind: WorkspaceMutationKind,
  ): Promise<boolean>;
}

export type RuntimeProgressPort = Pick<ContributionsProgressPort, "progress">;

export interface OnboardingChecklistReader {
  readMany(agentIds: readonly string[]): Promise<Map<string, OnboardingStep[]>>;
}

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

    const chat = telegramChatOf(flow.conversationId);
    const existing = await deps.binding.findAgentByConversation(chat);
    if (existing && existing.agentId !== agentId) {
      return err({ type: "ChatAlreadyBound" as const });
    }
    if (!existing) {
      const outcome = await deps.binding.bind(chat, agentId, flow.keycloakSub);
      if (outcome === "conflict") {
        const raced = await deps.binding.findAgentByConversation(chat);
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
        conversationId: chat,
        telegramUserId: flow.telegramUserId,
      },
    });

    emit({
      type: EventType.TelegramChatBound,
      ownerSub: flow.keycloakSub,
      agentId,
    });

    const post = await deps.binding.postMessage(
      agentId,
      chat,
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
        detail: { conversationId: chat },
      });
    }

    return ok({ chatTitle: flow.chatTitle ?? null });
  };
}

const NO_BACKGROUND_WORK: AgentBackgroundWork = {
  sessions: [],
  keptProcesses: 0,
  openLinks: 0,
};

export function executeBackgroundWorkRead(deps: {
  getAgent: (id: string) => Promise<Pick<InfraAgent, "hibernated"> | null>;
  agentServiceStatus: AgentServiceStatusClient;
}) {
  return async (id: string): Promise<AgentBackgroundWork | null> => {
    const infra = await deps.getAgent(id);
    if (!infra) return null;
    if (infra.hibernated) return NO_BACKGROUND_WORK;
    try {
      return await deps.agentServiceStatus.backgroundWork(id);
    } catch {
      return NO_BACKGROUND_WORK;
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
    if (deps.owner)
      emit({
        type: EventType.TelegramChatUnbound,
        ownerSub: deps.owner,
        agentId,
      });
    return ok(null);
  };
}

interface SlackConversationRef {
  channelId: string;
  teamId: string;
}

function slackConversationRef(channel: {
  slackChannelId: string;
  teamId?: string;
}): SlackConversationRef {
  return { channelId: channel.slackChannelId, teamId: channel.teamId ?? "" };
}

function slackConversationKey(ref: SlackConversationRef): string {
  return `${ref.teamId}/${ref.channelId}`;
}

const SLACK_LABEL_BUDGET_MS = 2_000;

function withinBudget<T>(
  work: Promise<T>,
  budgetMs: number,
): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), budgetMs);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

export interface SlackBindingPort {
  peekFlow(flowId: string): Promise<{
    slackChannelId: string;
    teamId: string;
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
  findChannelBindings: (
    slackChannelId: string,
  ) => Promise<{ agentId: string }[]>;
  connectShared: (
    agentId: string,
    slackChannelId: string,
    teamId: string,
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

    const existing = await deps.findChannelBindings(flow.slackChannelId);
    if (existing.some((b) => b.agentId === agentId))
      return err({ type: "ChannelAlreadyBound" as const });

    const connected = await deps.connectShared(
      agentId,
      flow.slackChannelId,
      flow.teamId,
    );
    if (!connected.ok) {
      switch (connected.error.type) {
        case "WorkspaceUnresolved":
          return err({ type: "WorkspaceUnresolved" as const });
        case "WorkspaceUnreachable":
          return err({ type: "WorkspaceUnreachable" as const });
        case "NoSlackWorkspace":
          return err({ type: "NoSlackWorkspace" as const });
        case "AgentNotFound":
          return err({ type: "AgentNotFound" as const });
        case "ChannelAlreadyBound":
          return err({ type: "ChannelAlreadyBound" as const });
        default:
          return connected.error satisfies never;
      }
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
    const alongside =
      existing.length === 1 ? "one agent" : `${existing.length} agents`;
    const post = await deps.binding.postMessage(
      agentId,
      flow.slackChannelId,
      isDm
        ? `This DM is now connected to ${agent.name}. Message it here; run the unbind command to disconnect.`
        : existing.length > 0
          ? `${agent.name} is now connected to this channel, alongside ${alongside} already here. Start a mention with an agent's name to reach that one; a mention with no name goes to the channel's default agent. Run the unbind command to disconnect.`
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

    return ok({
      slackChannelId: flow.slackChannelId,
      channelTitle: flow.channelTitle ?? null,
    });
  };
}

export function executeTemplateUpgrade(deps: {
  owner: string | undefined;
  actorKind?: "user" | "system";
  getAgent: (id: string) => Promise<InfraAgent | null>;
  readTemplateSpec: ReadTemplateSpec;
  patchSpec: (
    id: string,
    patch: { image: string; harness?: string },
  ) => Promise<InfraAgent | null>;
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

    const harness =
      infra.spec.harness ??
      (Object.hasOwn(RETIRED_TEMPLATE_HARNESS, infra.templateId)
        ? RETIRED_TEMPLATE_HARNESS[infra.templateId]
        : tmpl.spec.harness);
    const patched = await deps.patchSpec(id, {
      image: update.toImage,
      ...(harness ? { harness } : {}),
    });
    if (!patched) return err({ type: "AgentNotFound" as const });
    securityLog("info", "agent.upgrade", {
      category: "resource",
      actor: deps.owner ?? null,
      actorKind: deps.actorKind ?? "user",
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

function dropProtectedEnvs(env: EnvVar[]): EnvVar[] {
  return env.filter((e) => !isProtectedAgentEnvName(e.name));
}

function withUserEnv(infra: InfraAgent, env: EnvVar[]): InfraAgent {
  return { ...infra, spec: { ...infra.spec, env } };
}

// UNIT_BOUNDARY_DESCRIPTION: refuses a new agent when its owner's shared storage is too full to hold one machine, in the runner's own figures. Unreadable or absent is null, which refuses nothing.
export interface StorageGatePort {
  assertCanCreateVm(): Promise<void>;
}

export function createAgentsService(deps: {
  repo: AgentsRepository;
  agentEnvRepo: AgentEnvRepository;
  agentIdleTimeoutMinutes: number;
  owner: string | undefined;
  readTemplateSpec: ReadTemplateSpec;
  lastHelloAt?: (agentId: string) => Promise<Date | null>;
  presetSeeder?: PresetSeeder;
  cleanupHooks: readonly AgentCleanupHook[];
  registrySecretPort: AgentRegistrySecretPort;
  secretRefs: AgentSecretRefPort;
  runtimeMutator: RuntimeMutator;
  contributionsProgress: ContributionsProgressPort;
  onboardingChecklists: OnboardingChecklistReader;
  agentServiceStatus: AgentServiceStatusClient;
  agentDefaultLimits: DefaultResourceLimits;
  defaultHarness?: string;
  telemetry?: boolean;
  storageGate?: StorageGatePort;
  grantProvisioner?: {
    resolveSpecGrants(sel: {
      connectionIds: string[];
      providerConnectionId?: string;
    }): Promise<{ grantedConnectionIds: string[] }>;
    defaultProviders(
      connectionIds: string[],
      template: { harness?: string; providers?: readonly string[] },
    ): Promise<string[]>;
    applyAfterCreate(
      agentId: string,
      sel: { connectionIds: string[] },
    ): Promise<void>;
  };
  listChannelsByOwner: () => Promise<Map<string, ChannelConfig[]>>;
  listChannelsByAgent: (agentId: string) => Promise<ChannelConfig[]>;
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
    claimDefaultIfVacant: (
      tx: Tx,
      agentId: string,
      slackChannelId: string,
    ) => Promise<boolean>;
  };
  resolveSlackWorkspace: (
    slackChannelId: string,
  ) => Promise<
    | { kind: "resolved"; teamId: string }
    | { kind: "unknown" }
    | { kind: "unreachable" }
    | { kind: "none" }
  >;
  findSlackBindings: (slackChannelId: string) => Promise<
    {
      agentId: string;
      owner: string;
      teamId: string;
      ambient: boolean;
      isDefault: boolean;
    }[]
  >;
  telegramBinding?: TelegramBindingPort;
  slackBinding?: SlackBindingPort;
  resolveSlackConversationLabels?: (
    refs: SlackConversationRef[],
  ) => Promise<
    (SlackConversationRef & { label: SlackConversationLabel | null })[]
  >;
  readSlackLoopGuardDrops?: (
    slackChannelIds: string[],
  ) => Promise<Map<string, SlackLoopGuardDrops>>;
  editors: AgentEditorsRepository;
  editorEmail: string | null;
  resolveUserEmail: (sub: string) => Promise<string | null>;
}): AgentsService {
  // UNIT_BOUNDARY_DESCRIPTION: every key of the Secret a secretRef names becomes the agent's environment, and the name alone reaches any Secret in the agent namespace, so a secretRef is accepted only for a Secret its agent's owner holds. An empty one clears the field and needs no check. The refusal reads the same whether the Secret is missing or belongs to someone else, so it cannot be used to learn which Secrets exist.
  async function assertOwnSecretRef(
    secretRef: string | undefined,
    owner: string | undefined,
    agentId?: string,
  ): Promise<void> {
    if (!secretRef) return;
    if (owner && (await deps.secretRefs.isOwnedBy(secretRef, owner))) return;
    securityLog("warn", "agent.secret_ref.refused", {
      category: "resource",
      actor: deps.owner ?? null,
      actorKind: "user",
      result: "failure",
      ...(agentId ? { agentId } : {}),
      target: secretRef,
      reason: "secret not owned by the agent's owner",
    });
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `secretRef "${secretRef}" does not name a Secret you own`,
    });
  }

  async function assertNameFree(
    name: string,
    owner: string | undefined,
    agentId?: string,
  ): Promise<void> {
    const taken = (await deps.repo.list(owner)).some(
      (a) => a.name === name && a.id !== agentId,
    );
    if (taken)
      throw new TRPCError({
        code: "CONFLICT",
        message: `you already have an agent named "${name}"`,
      });
  }

  async function safeStatus(id: string): Promise<ContributionsStatus> {
    try {
      return await deps.contributionsProgress.status(id);
    } catch {
      return {
        settled: true,
        failures: [],
        preparingWorkspace: false,
        workspaceFailures: [],
        features: runtimeFeaturesOf(null),
        unsupportedKinds: [],
      };
    }
  }

  async function slackConversationLabels(
    channelLists: ChannelConfig[][],
  ): Promise<Map<string, SlackConversationLabel | null>> {
    const labels = new Map<string, SlackConversationLabel | null>();
    if (!deps.resolveSlackConversationLabels) return labels;
    const refs = new Map<string, SlackConversationRef>();
    for (const channel of channelLists.flat()) {
      if (channel.type !== ChannelType.Slack) continue;
      const ref = slackConversationRef(channel);
      refs.set(slackConversationKey(ref), ref);
    }
    if (refs.size === 0) return labels;
    const resolved = await withinBudget(
      deps.resolveSlackConversationLabels([...refs.values()]),
      SLACK_LABEL_BUDGET_MS,
    );
    for (const entry of resolved ?? []) {
      labels.set(slackConversationKey(entry), entry.label);
    }
    return labels;
  }

  type SlackChannelNotes = {
    labels: Map<string, SlackConversationLabel | null>;
    loopGuard: Map<string, SlackLoopGuardDrops>;
  };

  async function slackLoopGuardDrops(
    channelLists: ChannelConfig[][],
  ): Promise<Map<string, SlackLoopGuardDrops>> {
    const ids = [
      ...new Set(
        channelLists
          .flat()
          .flatMap((c) =>
            c.type === ChannelType.Slack ? c.slackChannelId : [],
          ),
      ),
    ];
    if (!deps.readSlackLoopGuardDrops || ids.length === 0) return new Map();
    return deps.readSlackLoopGuardDrops(ids).catch((err: unknown) => {
      getLogger().warn(
        { error: err instanceof Error ? err.message : String(err) },
        "agent.channels.loop_guard_unread",
      );
      return new Map();
    });
  }

  async function slackChannelNotes(
    channelLists: ChannelConfig[][],
  ): Promise<SlackChannelNotes> {
    const [labels, loopGuard] = await Promise.all([
      slackConversationLabels(channelLists),
      slackLoopGuardDrops(channelLists),
    ]);
    return { labels, loopGuard };
  }

  async function labelledChannelsOf(agentId: string): Promise<ChannelConfig[]> {
    const channels = await deps.listChannelsByAgent(agentId);
    return withSlackChannelNotes(channels, await slackChannelNotes([channels]));
  }

  function withSlackChannelNotes(
    channels: ChannelConfig[],
    notes: SlackChannelNotes,
  ): ChannelConfig[] {
    return channels.map((channel) => {
      if (channel.type !== ChannelType.Slack) return channel;
      const label = notes.labels.get(
        slackConversationKey(slackConversationRef(channel)),
      );
      const loopGuard = notes.loopGuard.get(channel.slackChannelId);
      return {
        ...channel,
        ...(label ? { label } : {}),
        ...(loopGuard ? { loopGuard } : {}),
      };
    });
  }

  async function templateUpdateFor(
    infra: InfraAgent,
  ): Promise<TemplateUpdate | undefined> {
    if (!infra.templateId) return undefined;
    const tmpl = await deps.readTemplateSpec(infra.templateId);
    if (!tmpl) return undefined;
    return templateImageUpdate(
      infra.spec.image,
      tmpl.spec.image,
      infra.imageUpdateRefused,
    );
  }

  async function project(
    infra: InfraAgent,
  ): Promise<ReturnType<typeof assembleAgent>> {
    const [channels, status, userEnv, templateUpdate, checklists] =
      await Promise.all([
        labelledChannelsOf(infra.id),
        safeStatus(infra.id),
        deps.agentEnvRepo.list(infra.id),
        templateUpdateFor(infra),
        deps.onboardingChecklists.readMany([infra.id]),
      ]);
    return assembleAgent(
      withUserEnv(infra, userEnv),
      channels,
      status.failures,
      deps.agentIdleTimeoutMinutes,
      status.preparingWorkspace,
      templateUpdate,
      status.features,
      status.unsupportedKinds,
      status.workspaceFailures,
      checklists.get(infra.id),
    );
  }

  async function ownsOrDeny(id: string, surface: string): Promise<boolean> {
    if (!deps.owner || (await deps.repo.isOwnedBy(id, deps.owner))) return true;
    securityLog("warn", "authz.owner_mismatch", {
      category: "authz",
      actor: deps.owner,
      actorKind: "user",
      agentId: id,
      decision: "deny",
      reason: "not-owner",
      detail: { surface },
    });
    return false;
  }

  async function namedAgent(
    id: string,
  ): Promise<{ id: string; name: string } | null> {
    const infra = await deps.repo.get(id, deps.owner);
    return infra ? { id: infra.id, name: infra.name } : null;
  }

  const connectSlackImpl = async (
    id: string,
    slackChannelId: string,
    ambient?: boolean,
    knownWorkspace?: string,
    customEmoji?: string[] | null,
  ): Promise<ConnectSlackResult> => {
    const infra = await deps.repo.get(id, deps.owner);
    if (!infra) return err({ type: "AgentNotFound" });

    const existing = (await deps.findSlackBindings(slackChannelId)).find(
      (b) => b.agentId === id,
    );

    const settledWorkspace = knownWorkspace ?? existing?.teamId;
    const workspace =
      settledWorkspace === undefined
        ? await deps.resolveSlackWorkspace(slackChannelId)
        : ({ kind: "resolved", teamId: settledWorkspace } as const);
    if (workspace.kind === "unreachable") {
      return err({ type: "WorkspaceUnreachable" as const });
    }
    if (workspace.kind === "none") {
      return err({ type: "NoSlackWorkspace" as const });
    }
    if (workspace.kind !== "resolved") {
      return err({ type: "WorkspaceUnresolved" as const });
    }

    const requestedAmbient = ambient === true;

    const txResult = await deps.unitOfWork(async (tx) => {
      try {
        await deps.channelsTxRepo.upsertChannel(tx, id, {
          type: ChannelType.Slack,
          slackChannelId,
          ...(workspace.teamId ? { teamId: workspace.teamId } : {}),
          ...(requestedAmbient ? { ambient: true } : {}),
          ...(customEmoji !== undefined ? { customEmoji } : {}),
        });
      } catch (e) {
        if (isSlackChannelUniqueViolation(e)) {
          return err({ type: "ChannelAlreadyBound" as const });
        }
        throw e;
      }
      const claimedDefault = existing
        ? false
        : await deps.channelsTxRepo.claimDefaultIfVacant(
            tx,
            id,
            slackChannelId,
          );
      const channels = await deps.channelsTxRepo.listByAgent(tx, id);
      return ok({ channels, claimedDefault });
    });

    if (!txResult.ok) return txResult;

    if (txResult.value.claimedDefault) {
      securityLog("info", "channel.default_changed", {
        category: "authz-list",
        actor: deps.owner ?? null,
        actorKind: "user",
        surface: "slack",
        agentId: id,
        result: "success",
        detail: { slackChannelId, basis: "first-connect" },
      });
    }

    emit({
      type: EventType.SlackConnected,
      agentId: id,
      slackChannelId,
      ownerSub: infra.owner ?? deps.owner ?? null,
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

    const boundChannels = txResult.value.channels;
    const [status, channelLabels, templateUpdate] = await Promise.all([
      safeStatus(id),
      slackChannelNotes([boundChannels]),
      templateUpdateFor(infra),
    ]);
    return ok(
      assembleAgent(
        infra,
        withSlackChannelNotes(boundChannels, channelLabels),
        status.failures,
        deps.agentIdleTimeoutMinutes,
        status.preparingWorkspace,
        templateUpdate,
        status.features,
        status.unsupportedKinds,
        status.workspaceFailures,
        (await deps.onboardingChecklists.readMany([id])).get(id),
      ),
    );
  };

  async function listOwned(): Promise<Agent[]> {
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

    const [failuresMap, envMap, channelLabels, checklistMap] =
      await Promise.all([
        deps.contributionsProgress
          .statusMany([...infraIds])
          .catch(() => new Map<string, ContributionsStatus>()),
        deps.agentEnvRepo.listMany([...infraIds]),
        slackChannelNotes([...channelMap.values()]),
        deps.onboardingChecklists.readMany([...infraIds]),
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
        withSlackChannelNotes(channelMap.get(infra.id) ?? [], channelLabels),
        status?.failures ?? [],
        deps.agentIdleTimeoutMinutes,
        status?.preparingWorkspace ?? false,
        templateImage
          ? templateImageUpdate(
              infra.spec.image,
              templateImage,
              infra.imageUpdateRefused,
            )
          : undefined,
        status?.features ?? runtimeFeaturesOf(null),
        status?.unsupportedKinds ?? [],
        status?.workspaceFailures ?? [],
        checklistMap.get(infra.id),
      );
    });
  }

  async function editorAccess(infra: InfraAgent, editors: string[]) {
    return {
      role: "editor" as const,
      ownerEmail: infra.owner
        ? await deps.resolveUserEmail(infra.owner).catch(() => null)
        : null,
      editors,
    };
  }

  async function listShared(): Promise<AgentWithAccess[]> {
    if (deps.editorEmail === null || deps.owner === undefined) return [];
    const caller = { sub: deps.owner, editorEmail: deps.editorEmail };
    const shared = await Promise.all(
      (await deps.editors.agentIdsFor(deps.editorEmail)).map(async (id) => {
        const infra = await deps.repo.get(id);
        if (!infra) return [];
        const editors = await deps.editors.list(id);
        if (accessTo(infra.owner, editors, caller) !== "editor") return [];
        const [agent, access] = await Promise.all([
          project(infra),
          editorAccess(infra, editors),
        ]);
        return [{ agent, access }];
      }),
    );
    return shared.flat();
  }

  return {
    list: listOwned,

    async listWithAccess(scope) {
      const owned = await listOwned();
      const editors = await deps.editors.listMany(owned.map((a) => a.id));
      const mine = owned.map((agent) => ({
        agent,
        access: {
          role: "owner" as const,
          editors: editors.get(agent.id) ?? [],
        },
      }));
      return match(scope)
        .with("mine", () => mine)
        .with("all", async () => [...mine, ...(await listShared())])
        .exhaustive();
    },

    async getWithAccess(id) {
      const infra = await deps.repo.get(id);
      if (!infra) return null;
      const editors = await deps.editors.list(id);
      const role =
        deps.owner === undefined
          ? "owner"
          : accessTo(infra.owner, editors, {
              sub: deps.owner,
              editorEmail: deps.editorEmail,
            });
      if (role === null) return null;
      const agent = await project(infra);
      return {
        agent,
        access:
          role === "owner"
            ? { role, editors }
            : await editorAccess(infra, editors),
      };
    },

    async setEditors(id, emails) {
      if (!deps.owner || !(await ownsOrDeny(id, "set-editors")))
        return { ok: false, error: { type: "AgentNotFound" } };
      const ownerEmail = await deps.resolveUserEmail(deps.owner);
      if (namesOwner(emails, [ownerEmail, deps.editorEmail]))
        return { ok: false, error: { type: "OwnEmail" } };
      const change = await deps.editors.replace(id, emails);
      securityLog("info", "agent.editors_set", {
        category: "authz-list",
        actor: deps.owner,
        actorKind: "user",
        agentId: id,
        result: "success",
        detail: {
          added: change.added,
          removed: change.removed,
          count: change.editors.length,
        },
      });
      const changed = [...change.added, ...change.removed];
      if (changed.length > 0)
        emit({
          type: EventType.AgentEditorsChanged,
          agentId: id,
          ownerSub: deps.owner,
          emails: changed,
        });
      return { ok: true, value: change.editors };
    },

    async leave(id) {
      if (deps.editorEmail === null)
        return { ok: false, error: { type: "NotAnEditor" } };
      const infra = await deps.repo.get(id);
      if (!infra) return { ok: false, error: { type: "AgentNotFound" } };
      if (!(await deps.editors.remove(id, deps.editorEmail)))
        return { ok: false, error: { type: "NotAnEditor" } };
      securityLog("info", "agent.editor_leave", {
        category: "authz-list",
        actor: deps.owner ?? null,
        actorKind: "user",
        agentId: id,
        result: "success",
      });
      emit({
        type: EventType.AgentEditorsChanged,
        agentId: id,
        ...(infra.owner ? { ownerSub: infra.owner } : {}),
        emails: [deps.editorEmail],
      });
      return { ok: true, value: { name: infra.name } };
    },

    /**
     * UNIT_BOUNDARY_DESCRIPTION: read from the Agent resources' image pins,
     * since a hibernated agent has said no hello since it slept. The count
     * the old runtime path waits on; a key bound to some agents counts only
     * those.
     */
    async runtimeFleet(agentIds) {
      const infraAgents = (await deps.repo.list(deps.owner)).filter(
        (a) => !agentIds || agentIds.includes(a.id),
      );
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
      const outdated: RuntimeFleetAgent[] = [];
      let onCurrent = 0;
      for (const infra of infraAgents) {
        const templateImage = infra.templateId
          ? templateImages.get(infra.templateId)
          : undefined;
        const update = templateImage
          ? templateImageUpdate(infra.spec.image, templateImage)
          : undefined;
        if (!update) {
          onCurrent += 1;
          continue;
        }
        const hello = await deps.lastHelloAt?.(infra.id);
        outdated.push({
          agentId: infra.id,
          name: infra.name,
          image: update.fromImage,
          templateImage: update.toImage,
          lastHello: hello ? hello.toISOString() : null,
        });
      }
      return { onCurrent, outdated };
    },

    async get(id) {
      const infra = await deps.repo.get(id, deps.owner);
      if (!infra) return null;
      return project(infra);
    },

    backgroundWork: executeBackgroundWorkRead({
      getAgent: (id) => deps.repo.get(id, deps.owner),
      agentServiceStatus: deps.agentServiceStatus,
    }),

    async create(input: AgentCreateInput) {
      if (input.vm === false)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "this install runs every agent as a machine on a VM runner, so a container agent cannot be created; the field that asked for one is refused rather than ignored",
        });
      let spec: Record<string, unknown>;
      let templateId: string | undefined;
      let templateProviders: readonly string[] | undefined;
      const requestedTemplate =
        input.templateId ??
        (input.image === undefined ? DEFAULT_TEMPLATE_ID : undefined);
      if (requestedTemplate) {
        const tmpl = await deps.readTemplateSpec(requestedTemplate);
        if (!tmpl) {
          throw new TRPCError(
            input.templateId === undefined
              ? {
                  code: "BAD_REQUEST",
                  message:
                    "this install has no default template; name a templateId or an image",
                }
              : {
                  code: "NOT_FOUND",
                  message: `template "${requestedTemplate}" not found`,
                },
          );
        }
        spec = assembleSpecFromTemplate(
          input.name,
          tmpl.spec,
          {
            description: input.description,
            storage: input.storage,
          },
          deps.agentDefaultLimits,
        );
        if (input.harness !== undefined) spec.harness = input.harness;
        if (Object.hasOwn(RETIRED_TEMPLATE_HARNESS, requestedTemplate))
          spec.harness ??= RETIRED_TEMPLATE_HARNESS[requestedTemplate];
        if (requestedTemplate === DEFAULT_TEMPLATE_ID)
          spec.harness ??= deps.defaultHarness;
        templateId = requestedTemplate;
        templateProviders = tmpl.spec.providers;
      } else {
        spec = assembleSpecFromImage(
          input.name,
          {
            image: input.image,
            description: input.description,
            storage: input.storage,
          },
          deps.agentDefaultLimits,
        );
      }
      await deps.storageGate?.assertCanCreateVm();
      const templateEnv = seedTelemetryIdentity(
        (spec.env as EnvVar[] | undefined) ?? [],
        input.name,
        deps.telemetry === true,
      );
      delete spec.env;
      if (input.secretRef !== undefined) spec.secretRef = input.secretRef;
      if (input.avatar !== undefined) spec.avatar = input.avatar;
      if (input.hibernationTimeoutMin !== undefined)
        spec.hibernationTimeout = minutesToDuration(
          input.hibernationTimeoutMin,
        );
      if (input.telemetryAttributionId !== undefined)
        spec.telemetryAttributionId = input.telemetryAttributionId;
      if (input.environmentOf !== undefined) {
        spec.environmentOf = input.environmentOf;
        delete spec.harness;
      }
      if (input.requireConnectionAddress !== false)
        spec.requireConnectionAddress = true;

      const providerConnectionId = input.providerConnectionId;
      const defaultProviders =
        providerConnectionId === undefined &&
        templateId !== undefined &&
        !input.noDefaultProvider
          ? ((await deps.grantProvisioner?.defaultProviders(
              input.connectionIds ?? [],
              {
                ...(typeof spec.harness === "string" && {
                  harness: spec.harness,
                }),
                ...(templateProviders && { providers: templateProviders }),
              },
            )) ?? [])
          : [];
      const grantSel = {
        connectionIds: Array.from(
          new Set([
            ...(input.connectionIds ?? []),
            ...(providerConnectionId ? [providerConnectionId] : []),
            ...defaultProviders,
          ]),
        ),
        providerConnectionId,
      };
      if (input.providerConnectionId && !deps.grantProvisioner) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "provider validation is unavailable",
        });
      }
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
      await assertOwnSecretRef(input.secretRef, owner);
      await assertNameFree(input.name, owner);
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
      if (input.kbShareRoots && input.kbShareRoots.length > 0)
        createAnnotations[ANN_KB_SHARE_ROOTS] = input.kbShareRoots.join(",");
      if (input.starterKit)
        createAnnotations[ANN_STARTER_KIT] = input.starterKit;
      if (input.starterKitDefaultModel)
        createAnnotations[ANN_STARTER_KIT_DEFAULT_MODEL] =
          input.starterKitDefaultModel;
      if (input.starterKitSeed)
        createAnnotations[ANN_STARTER_KIT_SEED] = JSON.stringify(
          input.starterKitSeed,
        );

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

      const userEnv = dropProtectedEnvs([...templateEnv, ...(input.env ?? [])]);
      if (userEnv.length > 0)
        await deps.agentEnvRepo.replace(infra.id, userEnv);

      if (deps.presetSeeder) {
        await deps.presetSeeder.seed(
          infra.id,
          input.egressPreset ?? "trusted",
          owner,
        );
      }

      const createdAt = new Date();
      await deps.runtimeMutator.bump(infra.id, [
        ...(input.gitRepo
          ? [
              workspaceSeedEvent(
                "workspace-seed",
                infra.id,
                input.gitRepo,
                createdAt,
              ),
            ]
          : []),
        ...(seedsAgentInstructions(input)
          ? [
              agentInstructionsEvent(
                infra.id,
                AGENT_INSTRUCTIONS_TEMPLATE,
                createdAt,
              ),
            ]
          : []),
      ]);

      if (deps.grantProvisioner && hasInitialGrants) {
        await deps.grantProvisioner.applyAfterCreate(infra.id, grantSel);
      }

      const agent = assembleAgent(
        withUserEnv(infra, userEnv),
        [],
        [],
        deps.agentIdleTimeoutMinutes,
        false,
        undefined,
        runtimeFeaturesOf(null),
        [],
        [],
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
        character: avatarCharacter(agent.spec.avatar, owner, agent.name),
      });
      return agent;
    },

    async update(input: AgentUpdateInput) {
      let renamed = false;
      let keptAvatar: string | undefined;
      if (input.secretRef || input.name !== undefined) {
        const current = await deps.repo.get(input.id, deps.owner);
        if (!current) return null;
        await assertOwnSecretRef(input.secretRef, current.owner, input.id);
        if (input.name !== undefined && input.name !== current.name) {
          renamed = true;
          await assertNameFree(input.name, current.owner, input.id);
          if (input.avatar === undefined && !current.spec.avatar)
            keptAvatar = avatarCharacter(
              undefined,
              current.owner ?? "",
              current.name,
            );
        }
      }
      const patch: Record<string, unknown> = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.description !== undefined)
        patch.description = input.description;
      const avatar = input.avatar === undefined ? keptAvatar : input.avatar;
      if (avatar !== undefined) patch.avatar = avatar;
      if (input.secretRef !== undefined) patch.secretRef = input.secretRef;
      if (input.hibernationTimeoutMin !== undefined)
        patch.hibernationTimeout =
          input.hibernationTimeoutMin === null
            ? null
            : minutesToDuration(input.hibernationTimeoutMin);
      if (input.requireConnectionAddress !== undefined)
        patch.requireConnectionAddress = input.requireConnectionAddress || null;
      if (input.whisper !== undefined)
        patch.whispersOff = input.whisper ? null : true;
      const infra =
        Object.keys(patch).length > 0
          ? await deps.repo.updateSpec(input.id, deps.owner, patch)
          : await deps.repo.get(input.id, deps.owner);
      if (!infra) return null;

      let env = input.env;
      if (env !== undefined) {
        env = dropProtectedEnvs(env);
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
        if (refreshed) await deps.agentEnvRepo.replace(input.id, refreshed);
        if (refreshed || renamed) {
          await deps.runtimeMutator.bump(input.id, []);
          await deps.runtimeMutator.enqueueAfterCommit(input.id);
        }
      }

      if (
        input.env !== undefined ||
        input.secretRef !== undefined ||
        input.requireConnectionAddress !== undefined ||
        input.whisper !== undefined
      ) {
        securityLog("info", "agent.update", {
          category: "resource",
          actor: deps.owner ?? null,
          actorKind: "user",
          agentId: input.id,
          result: "success",
          detail: {
            secretRefChanged: input.secretRef !== undefined,
            ...(input.whisper !== undefined ? { whisper: input.whisper } : {}),
            ...(input.requireConnectionAddress !== undefined
              ? { requireConnectionAddress: input.requireConnectionAddress }
              : {}),
            ...(env !== undefined ? { envKeys: env.map((e) => e.name) } : {}),
          },
        });
      }

      emit({
        type: EventType.AgentUpdated,
        agentId: input.id,
        ...(deps.owner ? { ownerSub: deps.owner } : {}),
      });
      return project(infra);
    },

    async delete(id) {
      const deleted = await deps.repo.delete(id, deps.owner);
      if (!deleted) return;
      for (const hook of deps.cleanupHooks) {
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
      emit({
        type: EventType.AgentDeleted,
        agentId: id,
        ...(deps.owner ? { ownerSub: deps.owner } : {}),
      });
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
      if (!(await ownsOrDeny(id, "agent.wake")))
        return err({ type: "AgentNotFound" });
      const woke = await deps.repo.wake(id);
      if (!woke.ok) return err(woke.error);
      const infra = woke.value;
      securityLog("info", "agent.wake", {
        category: "privileged",
        actor: deps.owner ?? null,
        actorKind: "user",
        agentId: id,
        result: "success",
      });
      emit({ type: EventType.AgentWoken, agentId: id });
      return ok(await project(infra));
    },

    async retryWorkspace(id, kind) {
      if (!(await ownsOrDeny(id, "agent.retryWorkspace"))) return null;
      const infra = await deps.repo.get(id);
      if (!infra) return null;
      if (!(await deps.contributionsProgress.retryWorkspaceMutation(id, kind)))
        return null;
      await deps.repo.wakeIfHibernated(id);
      securityLog("info", "agent.workspace_retry", {
        category: "privileged",
        actor: deps.owner ?? null,
        actorKind: "user",
        agentId: id,
        result: "success",
        detail: { kind },
      });
      return project((await deps.repo.get(id)) ?? infra);
    },

    async sleep(id) {
      if (!(await ownsOrDeny(id, "agent.sleep"))) return null;
      const current = await deps.repo.get(id, deps.owner);
      if (!current) return null;
      const effectiveTimeout = resolveEffectiveHibernationTimeoutMin(
        current.spec.hibernationTimeout,
        deps.agentIdleTimeoutMinutes,
      );
      const infra =
        effectiveTimeout === 0
          ? await deps.repo.requestStop(id)
          : await deps.repo.requestSleep(id);
      if (!infra) return null;
      securityLog("info", "agent.sleep", {
        category: "privileged",
        actor: deps.owner ?? null,
        actorKind: "user",
        agentId: id,
        result: "success",
      });
      return project(infra);
    },

    async setDisabled(id, disabled) {
      if (!(await ownsOrDeny(id, "agent.setDisabled")))
        return err({ type: "AgentNotFound" });
      const current = await deps.repo.get(id, deps.owner);
      if (!current) return err({ type: "AgentNotFound" });
      const infra = await deps.repo.setDisabled(id, disabled);
      if (!infra) return err({ type: "AgentNotFound" });
      securityLog("info", disabled ? "agent.disable" : "agent.enable", {
        category: "privileged",
        actor: deps.owner ?? null,
        actorKind: "user",
        agentId: id,
        result: "success",
      });
      emit({
        type: EventType.AgentUpdated,
        agentId: id,
        ...(deps.owner ? { ownerSub: deps.owner } : {}),
      });
      return ok(await project(infra));
    },

    async upgrade(id, expectedToImage) {
      const result = await executeTemplateUpgrade({
        owner: deps.owner,
        getAgent: (agentId) => deps.repo.get(agentId, deps.owner),
        readTemplateSpec: deps.readTemplateSpec,
        patchSpec: (agentId, patch) =>
          deps.repo.updateSpec(agentId, deps.owner, patch),
      })(id, expectedToImage);
      if (!result.ok) return result;
      emit({
        type: EventType.AgentUpdated,
        agentId: id,
        ...(deps.owner ? { ownerSub: deps.owner } : {}),
      });
      return ok(await project(result.value));
    },

    async ensureReady(id, opts) {
      if (deps.owner && !(await deps.repo.isOwnedBy(id, deps.owner))) {
        throw new TRPCError({ code: "NOT_FOUND", message: "agent not found" });
      }
      await deps.repo.ensureReady(id, opts);
    },

    async connectSlack(id, slackChannelId, ambient, customEmoji) {
      return connectSlackImpl(
        id,
        slackChannelId,
        ambient,
        undefined,
        customEmoji,
      );
    },

    async disconnectSlack(id, slackChannelId) {
      const infra = await deps.repo.get(id, deps.owner);
      if (!infra) return null;

      if (slackChannelId === undefined) {
        await deps.deleteChannelByType(id, ChannelType.Slack);
        emit({
          type: EventType.SlackDisconnected,
          agentId: id,
          ownerSub: infra.owner ?? deps.owner ?? null,
        });
        return project(infra);
      }

      const released = await deps.deleteSlackChannelByAgent(id, slackChannelId);
      if (released) {
        emit({
          type: EventType.SlackDisconnected,
          agentId: id,
          slackChannelId,
          ownerSub: infra.owner ?? deps.owner ?? null,
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
        chats: chats.map((c) => ({
          conversationId: c.id,
          title: c.title,
          direct: isTelegramDirectConversation(c.id),
        })),
      });
    },

    async unbindTelegramChat(agentId, conversationId) {
      const binding = deps.telegramBinding;
      if (!binding) return err({ type: "ChatNotFound" as const });
      return executeTelegramUnbind({
        owner: deps.owner,
        getAgent: namedAgent,
        binding,
      })(agentId, conversationId);
    },

    async bindTelegramChat(agentId, flowId) {
      const binding = deps.telegramBinding;
      if (!binding) return err({ type: "FlowInvalid" as const });
      return executeTelegramBind({
        owner: deps.owner,
        getAgent: namedAgent,
        binding,
      })(agentId, flowId);
    },

    async peekSlackBindFlow(flowId) {
      const binding = deps.slackBinding;
      if (!binding) return null;
      const flow = await binding.peekFlow(flowId);
      if (!flow) return null;
      if (!deps.owner || flow.keycloakSub !== deps.owner) return null;
      if (flow.channelTitle)
        return {
          slackChannelId: flow.slackChannelId,
          name: flow.channelTitle,
        };
      const workspace = await deps.resolveSlackWorkspace(flow.slackChannelId);
      if (workspace.kind !== "resolved") {
        return { slackChannelId: flow.slackChannelId };
      }
      const channel: ChannelConfig = {
        type: ChannelType.Slack,
        slackChannelId: flow.slackChannelId,
        ...(workspace.teamId ? { teamId: workspace.teamId } : {}),
      };
      const labels = await slackConversationLabels([[channel]]);
      const label = labels.get(
        slackConversationKey(slackConversationRef(channel)),
      );
      return {
        slackChannelId: flow.slackChannelId,
        ...(label?.kind === "channel" ? { name: label.name } : {}),
      };
    },

    async peekTelegramBindFlow(flowId) {
      const binding = deps.telegramBinding;
      if (!binding) return null;
      const flow = await binding.peekFlow(flowId);
      if (!flow) return null;
      if (!deps.owner || flow.keycloakSub !== deps.owner) return null;
      return {
        chatTitle: flow.chatTitle ?? null,
        direct: isTelegramDirectConversation(flow.conversationId),
      };
    },

    async bindSlackChannel(agentId, flowId) {
      const binding = deps.slackBinding;
      if (!binding) return err({ type: "FlowInvalid" as const });
      return executeSlackBind({
        owner: deps.owner,
        getAgent: namedAgent,
        findChannelBindings: deps.findSlackBindings,
        connectShared: (id, slackChannelId, teamId) =>
          connectSlackImpl(id, slackChannelId, undefined, teamId),
        binding,
      })(agentId, flowId);
    },
  };
}
