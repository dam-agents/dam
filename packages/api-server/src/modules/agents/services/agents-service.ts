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
  type BindTelegramChatResult,
  type BindSlackChannelResult,
  type ConnectSlackResult,
  type ListTelegramChatsResult,
  type UnbindTelegramChatResult,
  type TemplateUpdate,
  type UpgradeAgentError,
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
  /** Just the settled bit, for consumers that gate on it rather than report it.
   *  Carried by the port so the projection out of `ContributionsStatus` lives
   *  with the status shape instead of being re-derived at each call site. */
  isSettled(agentId: string): Promise<boolean>;
}
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
 * Port consumed by `bindTelegramChat()`. Declared locally (like
 * `PresetSeeder`) so the agents module doesn't import channels
 * infrastructure; the composition root assembles it from the bind-flow
 * store, the conversations repository, and the ChannelManager.
 */
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
  /** Best-effort confirmation into the chat, via the channel manager. */
  postMessage(
    agentId: string,
    conversationId: string,
    text: string,
  ): Promise<{ ok: true } | { error: string }>;
  /** Bound conversations for an agent, with human titles. */
  listConversations(agentId: string): Promise<{ id: string; title: string }[]>;
  unbind(conversationId: string): Promise<void>;
}

/**
 * The bind flow, extracted from the service so tests can drive it with
 * three narrow deps instead of the full service dependency set.
 */
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
      // A different signed-in user is trying to consume the flow. Same error
      // as an unknown flow — don't reveal that the id exists; the flow stays
      // alive so the right account can still complete within the TTL.
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
      // Flow stays alive — the user may pick the right agent, or run the
      // unbind command in the chat and retry.
      return err({ type: "ChatAlreadyBound" as const });
    }
    if (!existing) {
      const outcome = await deps.binding.bind(
        flow.conversationId,
        agentId,
        flow.keycloakSub,
      );
      if (outcome === "conflict") {
        // Lost an insert race — re-read to tell idempotent-same-agent apart
        // from a real clash.
        const raced = await deps.binding.findAgentByConversation(
          flow.conversationId,
        );
        if (!raced || raced.agentId !== agentId)
          return err({ type: "ChatAlreadyBound" as const });
      }
    }

    await deps.binding.consumeFlow(flowId);

    // The binding IS the consent grant: the owner lends this agent — its
    // credentials included — to everyone in the conversation.
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
      // Best-effort: the binding is committed; the confirmation is courtesy.
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

/** Owner-side disconnect, extracted like `executeTelegramBind` for tests. */
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

    // Courtesy note BEFORE the row goes away — outbound posting validates
    // the binding, so this ordering is load-bearing. Best-effort either way.
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

/**
 * Port consumed by `bindSlackChannel()`. Unlike Telegram, the durable write
 * is the shared `channels` row, so the port only carries
 * the bind-flow bearer store and the confirmation post; the ownership check
 * and the write reuse the service's own `connectSlack` path.
 */
export interface SlackBindingPort {
  peekFlow(flowId: string): Promise<{
    slackChannelId: string;
    slackUserId: string;
    keycloakSub: string;
    channelTitle?: string;
  } | null>;
  consumeFlow(flowId: string): Promise<void>;
  /** Best-effort confirmation into the channel, via the channel manager. */
  postMessage(
    agentId: string,
    slackChannelId: string,
    text: string,
  ): Promise<{ ok: true } | { error: string }>;
}

/**
 * The in-chat Slack bind flow, extracted like `executeTelegramBind` so tests
 * can drive it with narrow deps. The binder must own the agent (`getAgent` is
 * owner-scoped) and must be the flow's authenticated user; an already-bound
 * channel is rejected outright (no in-place override).
 */
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
      // A different signed-in user is trying to consume the flow. Same error
      // as an unknown flow — no oracle; the flow stays alive within its TTL.
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

    // No override: reject if the channel is already bound to any agent — the
    // prior binder must unbind first.
    const existing = await deps.findChannelBinding(flow.slackChannelId);
    if (existing) return err({ type: "ChannelAlreadyBound" as const });

    // A shared channel bind is ambient-off by default: the agent answers
    // mentions only until the binder opts the channel into read-along with the
    // ambient command. Ambient has the agent read every message in the channel,
    // so keeping that broader exposure an explicit opt-in is the safe default.
    const connected = await deps.connectShared(agentId, flow.slackChannelId);
    if (!connected.ok) {
      // Ownership was already proven by getAgent, so a non-ok here is a lost
      // race (the channel was bound between the check and the write).
      return err({ type: "ChannelAlreadyBound" as const });
    }

    await deps.binding.consumeFlow(flowId);

    // The binding IS the consent grant: the binder lends this agent — its
    // credentials included — to everyone in the channel.
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

    // A 1:1 DM conversation id starts with "D" — tailor the confirmation so a
    // private DM doesn't read as a shared channel ("everyone here").
    const isDm = flow.slackChannelId.startsWith("D");
    const post = await deps.binding.postMessage(
      agentId,
      flow.slackChannelId,
      isDm
        ? `This DM is now connected to ${agent.name}. Message it here; run the unbind command to disconnect.`
        : `This channel is now connected to ${agent.name}. Everyone here can use it; run the unbind command to disconnect.`,
    );
    if ("error" in post) {
      // Best-effort: the binding is committed; the confirmation is courtesy.
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

/**
 * The template-upgrade flow (#1077), extracted like the bind flows so tests
 * can drive it with narrow deps. v1 re-applies the template's image only —
 * template env/mounts stay frozen at create time by design (re-flowing them
 * risks clobbering user edits / immutable volumeClaimTemplates).
 */
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

    // Binding consent: the confirmed image must still be what the template
    // ships, or the user would apply a movement they never reviewed.
    if (expectedToImage !== undefined && expectedToImage !== tmpl.spec.image)
      return err({ type: "TemplateMoved" as const });

    const update = templateImageUpdate(infra.spec.image, tmpl.spec.image);
    // Already current — idempotent success, no patch, no pod roll.
    if (!update) return ok(infra);

    const patched = await deps.patchImage(id, update.toImage);
    if (!patched) return err({ type: "AgentNotFound" as const });
    // Swaps what code the pod runs — record the exact image movement.
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

/** Port: budget gate for resizing an UP agent (#1900) — a live resize rolls
 *  the pod at replicas=1 and never crosses the controller's 0→1 gate, so the
 *  api-server owns this one check. Wired from the budgets module; structural
 *  so this module doesn't import across the boundary. */
export interface ResizeGatePort {
  assertResizeFits(
    agent: InfraAgent,
    newSize: { cpu?: string; memory?: string },
  ): Promise<void>;
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
  /** Chart-default agent size (limits), stamped concretely at create (#1900). */
  agentDefaultLimits: DefaultResourceLimits;
  /** KubeVirt vm backend available in this install; absent = false. */
  virtualizationEnabled?: boolean;
  /** Budget gate for live resizes; omitted by system compositions (which
   *  never resize) — a live resize without it is rejected. */
  resizeGate?: ResizeGatePort;
  /** Cross-replica critical section serializing resize check+patch per
   *  owner (Postgres advisory lock) — the courtesy ceiling check is
   *  read+check+patch and must not race across replicas. */
  resizeLock: <T>(key: string, fn: () => Promise<T>) => Promise<T>;
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
  /** Release one of the agent's Slack bindings; false when it held none for
   *  that conversation. */
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
  /** The Agent (if any) a Slack channel id is already bound to — global, since
   *  Slack bindings are unique across the whole install. */
  findSlackChannelBinding: (slackChannelId: string) => Promise<{
    agentId: string;
    ambient?: boolean;
  } | null>;
  /** Absent in the system-wide composition — binding is a user-facing flow. */
  telegramBinding?: TelegramBindingPort;
  /** Absent in the system-wide composition — the in-chat Slack bind is a
   *  user-facing flow driven from the authenticated UI picker. */
  slackBinding?: SlackBindingPort;
}): AgentsService {
  // Fail-soft: a transient outbox-DB error must never 500 an agent read.
  async function safeStatus(id: string): Promise<ContributionsStatus> {
    try {
      return await deps.contributionsSettled.status(id);
    } catch {
      return { settled: true, failures: [], preparingWorkspace: false };
    }
  }

  // Behind-the-template check (#1077): compares the create-time image capture
  // against the boot-loaded template. Memory-backed, so fine on every read.
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

  // Shared by the public connectSlack method and the in-chat bind flow, so
  // both take the same transactional-uniqueness and event path.
  const connectSlackImpl = async (
    id: string,
    slackChannelId: string,
    ambient?: boolean,
  ): Promise<ConnectSlackResult> => {
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

    // An ambient change is audited so the flip stays diagnosable after the
    // fact, but it is deliberately not announced in the channel — whoever made
    // the change confirms it on their own surface (the UI, the CLI, or the
    // ephemeral slash-command reply), never a channel-visible post.
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
        // Clearing bindings as a side-effect of a read — flag it so a
        // transient K8s read returning empty can't silently mass-purge.
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
        deps.contributionsSettled
          .statusMany([...infraIds])
          .catch(() => new Map<string, ContributionsStatus>()),
        deps.agentEnvRepo.listMany([...infraIds]),
      ]);

      // One template lookup per distinct id; agents from the same template
      // share the resolved image for the behind-the-template check (#1077).
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
        spec = assembleSpecFromTemplate(
          input.name,
          tmpl.spec,
          { description: input.description, size: input.size },
          deps.agentDefaultLimits,
        );
        templateId = input.templateId;
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
      // Template-declared env rides the rail like user env (seeded below), not
      // the CR — the controller no longer reads spec.env.
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
      // Invocation spawn stamps the root Driver id here so the target's
      // gateway attributes its telemetry to the Driver (#3041). Service-only:
      // the controller renders it into the gateway bootstrap, so it belongs in
      // the spec, not annotations. Never wire-settable (see types.ts).
      if (input.telemetryAttributionId !== undefined)
        spec.telemetryAttributionId = input.telemetryAttributionId;

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
      const agentId = input.id ?? generateK8sName("agent");

      if (input.registryCredential) {
        await deps.registrySecretPort.create(
          agentId,
          owner,
          input.registryCredential,
        );
        spec.imagePullSecretRef = deps.registrySecretPort.secretName(agentId);
      }

      // Sweepable (#2816): stamp the Agent Sweep annotations at create so an
      // ephemeral agent is marked from birth (no window where a spawned target
      // could hibernate before it is flagged). Durable agents omit them.
      // Agent Kind (#2946) rides the same create-time stamp: an agent either
      // belongs to its owning surface from birth or never.
      const createAnnotations: Record<string, string> = {};
      if (input.sweepable) {
        createAnnotations[ANN_SWEEPABLE] = "true";
        if (input.lifetimeMs && input.lifetimeMs > 0)
          createAnnotations[ANN_LIFETIME_MS] = String(input.lifetimeMs);
      }
      if (input.kind) createAnnotations[ANN_AGENT_KIND] = input.kind;
      if (input.kbTemplateId)
        createAnnotations[ANN_KB_TEMPLATE] = input.kbTemplateId;

      // No desiredState — a freshly-created agent runs (recent
      // activity), and the idle checker hibernates it once it goes quiet.
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

      // Input is ordered last so user env wins over a same-named template default (replace dedupes last-wins).
      const userEnv = preserveProtectedEnvs(
        [],
        [...templateEnv, ...(input.env ?? [])],
      );
      if (userEnv.length > 0)
        await deps.agentEnvRepo.replace(infra.id, userEnv);

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
        [],
        deps.agentIdleTimeoutMinutes,
      );
      // Records the agent's initial security posture (preset, secret ref,
      // env key names — never env values).
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
      // null clears the override (merge-patch deletes the key → inherit the global default).
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
        // A sleeping agent's new Size passes the controller's 0→1 gate on
        // its next start. An UP agent's resize is gated by the controller
        // at render (an over-ceiling grow parks the pair); the check here
        // is the synchronous courtesy in front of it — fail at save time
        // with a typed error instead of parking a moment later. Serialized
        // per owner around read+check+patch, with the read INSIDE the
        // lock: the shrink shortcut and the up/sleeping split must
        // classify against the same state the ceiling check runs on, or
        // two rapid resizes could classify an increase as a shrink.
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
        // Merge-patch merges nested objects, so only the provided
        // dimensions change; requests (operator escape hatch) survive.
        patch.resources = { limits: input.size };
      }
      // Both branches do the owner check; an env-only update skips the no-op CR patch.
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
        // Strip protected names, then bump + enqueue so a running agent applies it next turn.
        env = preserveProtectedEnvs([], env);
        if (input.name !== undefined)
          env = renamedTelemetryIdentity(env, input.name) ?? env;
        await deps.agentEnvRepo.replace(input.id, env);
        await deps.runtimeMutator.bump(input.id, []);
        await deps.runtimeMutator.enqueueAfterCommit(input.id);
      } else if (input.name !== undefined) {
        // Rename: keep the telemetry name attribute in step with the new
        // name; skipped entirely when the agent doesn't carry it.
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

      emit({ type: EventType.AgentUpdated, agentId: input.id });
      return project(infra);
    },

    async delete(id) {
      const deleted = await deps.repo.delete(id, deps.owner);
      if (!deleted) return;
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
      // A never-hibernate agent (effective timeout 0) runs regardless of
      // activity, so a non-sticky pause would silently self-revive within a
      // reconcile. For those, pause degrades to the sticky stop — down until
      // explicitly woken — which is the only stable "paused" it can have.
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

    // An agent may hold several Slack bindings (#3086), so a disconnect names
    // the conversation to release. Omitting it releases them all — the
    // pre-#3086 meaning, kept so an older client's `disconnectSlack(id)` still
    // does what it always did rather than silently releasing one of many.
    async disconnectSlack(id, slackChannelId) {
      const infra = await deps.repo.get(id, deps.owner);
      if (!infra) return null;

      if (slackChannelId === undefined) {
        await deps.deleteChannelByType(id, ChannelType.Slack);
        emit({ type: EventType.SlackDisconnected, agentId: id });
        return project(infra);
      }

      // Idempotent like the release-all path: an unbound conversation is not
      // an error, it just emits nothing.
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
