import type { z } from "zod";
import { ChannelType } from "../shared.js";
import type { AgentSpecCR } from "../../crd-types.gen.js";
import type {
  agentCreateInputSchema,
  agentKindSchema,
  agentUpdateInputSchema,
} from "./schemas.js";

export { ChannelType };

/** Env names that are managed by the platform/template and cannot be edited by users. */
export const PROTECTED_AGENT_ENV_NAMES: readonly string[] = ["PORT"];

export function isProtectedAgentEnvName(name: string): boolean {
  return PROTECTED_AGENT_ENV_NAMES.includes(name);
}

// --- Channels (attach to an Agent) ---

export interface Channel {
  type: ChannelType;
}

export interface SlackChannel extends Channel {
  type: ChannelType.Slack;
  slackChannelId: string;
  /** Ambient mode: the agent reads along in the channel and may chime in
   *  without being mentioned; absent = off. */
  ambient?: boolean;
}

export type ChannelConfig = SlackChannel;

// --- Agent ---

export type AgentState =
  | "starting"
  | "preparing_workspace"
  | "running"
  | "hibernating"
  | "hibernated"
  /** Parked (#1900): wants to run, but starting it would breach the owner's
   *  Ceiling. Waits at zero until a deliberate start after room frees. */
  | "over_budget"
  | "error";

// The public projection of the Agent CR spec: the generated AgentSpecCR (the
// Go-authored CRD is the single source) with name guaranteed (the CRD
// marks it optional). Layer A fields (security context, scheduling, pod
// metadata) are chart-only and never in the CRD spec, so they're absent here
// too. The connection/secret grants are api-server-written spec
// intent, so they belong in the spec.
export type AgentSpec = AgentSpecCR & { name: string };

/** The pending template upgrade (#1077): the template this agent came from
 *  now ships a different image than the one captured at create time. v1
 *  compares the image only — other template-derived fields stay frozen. */
export interface TemplateUpdate {
  fromImage: string;
  toImage: string;
}

export interface Agent {
  id: string;
  name: string;
  templateId?: string;
  /** Present when the agent is behind its template; absent when current,
   *  created from a raw image, or the template is no longer installed. */
  templateUpdate?: TemplateUpdate;
  spec: AgentSpec;
  /** Observed lifecycle state, synthesized from the controller's status.yaml. */
  state: AgentState;
  /** Effective idle timeout in minutes (0 = never): the per-agent override (spec.hibernationTimeout) resolved against the global default. */
  effectiveHibernationTimeoutMin: number;
  /** Latest controller-reported error, if any. */
  error?: string;
  stopRequested: boolean;
  /** Parked (#1900): starting this agent would breach its owner's compute
   *  Ceiling; pods stay down; free room and start it again (never-hibernate agents restart by themselves). */
  overBudget: boolean;
  /** The controller's reserved/ceiling figures for a parked agent. */
  overBudgetMessage?: string;
  /** Abnormal pod-termination cause (OOM / crash) while the pod is down; absent on normal lifecycle. */
  podTerminationReason?: string;
  /** Contributions that failed to install on the last settle; empty when healthy. */
  contributionFailures: { kind: string; message: string }[];
  /** External communication pathways bound to this agent. */
  channels: ChannelConfig[];
  /** Agent Kind: which first-class surface owns this agent (a Knowledge Base
   *  is an Agent + this marker). Absent on plain sandboxes. */
  kind?: AgentKind;
  /** The KB template a Knowledge Base was created from. Opaque here — the
   *  knowledge-bases surface owns the id set, so an unknown id (a newer
   *  writer) still round-trips. Absent on plain sandboxes and on Knowledge
   *  Bases created before the id was stamped. */
  kbTemplateId?: string;
}

export type AgentKind = z.infer<typeof agentKindSchema>;
/** The service-level create input. `kind` and `kbTemplateId` ride here but
 *  not in the wire schema: only an owning module's create path
 *  (knowledge-bases) may mark an agent, so the public agents.create strips
 *  them (Zod drops unknown keys). */
export type AgentCreateInput = z.infer<typeof agentCreateInputSchema> & {
  kind?: AgentKind;
  kbTemplateId?: string;
  /** Pre-minted agent id, service-level only (never on the wire): lets a
   *  caller that must record the id BEFORE the agent exists — invocations
   *  write their Postgres row first, so a list can never see an unattributed
   *  target — bind the two without a window. */
  id?: string;
  /** Root Driver id to attribute the agent's telemetry to, service-level
   *  only (never on the wire): a spawning Invocation stamps its root Driver
   *  here so the target's gateway credits the Driver's spend. A wire-settable
   *  value would forge attribution onto an agent the caller does not drive. */
  telemetryAttributionId?: string;
};
export type AgentUpdateInput = z.infer<typeof agentUpdateInputSchema>;

/** In-flight background work a session reported (#2965); advisory only. */
export interface BackgroundWorkItemView {
  id: string;
  description?: string;
  command?: string;
}

export interface SessionBackgroundWork {
  sessionId: string;
  items: BackgroundWorkItemView[];
}

export type UpgradeAgentError =
  | { type: "AgentNotFound" }
  /** Created from a raw image, or the template is no longer installed —
   *  deliberately one bucket: either way there is nothing to upgrade to. */
  | { type: "TemplateNotFound" }
  /** The template no longer ships the image the user consented to
   *  (moved between showing the diff and confirming) — re-review. */
  | { type: "TemplateMoved" };

export type UpgradeAgentResult =
  | { ok: true; value: Agent }
  | { ok: false; error: UpgradeAgentError };

export type ConnectSlackError =
  | { type: "AgentNotFound" }
  | { type: "ChannelAlreadyBound" };

export type ConnectSlackResult =
  | { ok: true; value: Agent }
  | { ok: false; error: ConnectSlackError };

export type BindSlackChannelError =
  /** Unknown, expired, or not-your-flow — deliberately one bucket so the
   *  error is no oracle for whether a flow id exists. */
  | { type: "FlowInvalid" }
  | { type: "AgentNotFound" }
  | { type: "ChannelAlreadyBound" };

export type BindSlackChannelResult =
  | { ok: true; value: { channelTitle: string | null } }
  | { ok: false; error: BindSlackChannelError };

export type BindTelegramChatError =
  /** Unknown, expired, or not-your-flow — deliberately one bucket so the
   *  error is no oracle for whether a flow id exists. */
  | { type: "FlowInvalid" }
  | { type: "AgentNotFound" }
  | { type: "ChatAlreadyBound" };

export type BindTelegramChatResult =
  | { ok: true; value: { chatTitle: string | null } }
  | { ok: false; error: BindTelegramChatError };

export type ListTelegramChatsError =
  | { type: "AgentNotFound" }
  /** Telegram is off for this install, so no bindings can be read. */
  | { type: "TelegramUnavailable" };

export interface TelegramChatView {
  conversationId: string;
  title: string;
}

export type ListTelegramChatsResult =
  | { ok: true; value: { chats: TelegramChatView[] } }
  | { ok: false; error: ListTelegramChatsError };

export type UnbindTelegramChatError =
  | { type: "AgentNotFound" }
  /** The conversation isn't bound to this agent (unknown, or another's). */
  | { type: "ChatNotFound" };

export type UnbindTelegramChatResult =
  | { ok: true; value: null }
  | { ok: false; error: UnbindTelegramChatError };

export interface AgentsService {
  list: () => Promise<Agent[]>;
  get: (id: string) => Promise<Agent | null>;
  /** Background work the agent's sessions report (#2965). Passive read —
   *  never wakes a pod; hibernated/unreachable → `[]`, unknown agent → null. */
  backgroundWork: (id: string) => Promise<SessionBackgroundWork[] | null>;
  create: (input: AgentCreateInput) => Promise<Agent>;
  update: (input: AgentUpdateInput) => Promise<Agent | null>;
  delete: (id: string) => Promise<void>;
  restart: (id: string) => Promise<boolean>;
  wake: (id: string) => Promise<Agent | null>;
  /** Hard stop (#1900): scale the agent down now to free its Reserved
   *  compute. Sticky against background activity; an explicit wake or a
   *  schedule fire restarts it. */
  stop: (id: string) => Promise<Agent | null>;
  /** Pause (#1900): scale down now like a stop, but non-sticky once down —
   *  the agent wakes on its next deliberate use (open chat, message,
   *  schedule), passing back through the budget gate. */
  pause: (id: string) => Promise<Agent | null>;
  /** Re-apply the current template's image to this agent (#1077). A running
   *  agent rolls onto the new image; a hibernated one picks it up on its
   *  next wake. Idempotent — an already-current agent succeeds unchanged.
   *  When `expectedToImage` is given, fails with TemplateMoved unless the
   *  template still ships exactly that image (binding consent). */
  upgrade: (
    id: string,
    expectedToImage?: string,
  ) => Promise<UpgradeAgentResult>;
  /**
   * Ensure the agent's pod is reachable. Waits for pod Ready, waking
   * from hibernation if needed. Idempotent; single-flight per id; bumps
   * `agent-platform.ai/last-activity` on every success. Channel adapters
   * and any server-side caller that needs to talk to the agent must await
   * this before connecting. `onWaking` fires when the call enters (or
   * joins) a cold-start wait, never on the already-ready fast path.
   */
  ensureReady: (id: string, opts?: { onWaking?: () => void }) => Promise<void>;
  connectSlack: (
    id: string,
    slackChannelId: string,
    ambient?: boolean,
  ) => Promise<ConnectSlackResult>;
  /** Release a Slack binding. An agent may hold several, so `slackChannelId`
   *  names the conversation to release; omitting it releases all of them. */
  disconnectSlack: (
    id: string,
    slackChannelId?: string,
  ) => Promise<Agent | null>;
  /** Consume a Slack bind flow (minted by the in-chat bind OAuth callback) and
   *  bind that channel to the caller's agent in shared mode. */
  bindSlackChannel: (
    agentId: string,
    flowId: string,
  ) => Promise<BindSlackChannelResult>;
  /** Consume a Telegram bind flow (minted by the /login OAuth callback) and
   *  bind that conversation to the caller's agent. */
  bindTelegramChat: (
    agentId: string,
    flowId: string,
  ) => Promise<BindTelegramChatResult>;
  /** The Telegram conversations bound to the caller's agent, with titles. */
  listTelegramChats: (agentId: string) => Promise<ListTelegramChatsResult>;
  /** Owner-side disconnect of a bound conversation (the UI counterpart of
   *  the in-chat unbind). */
  unbindTelegramChat: (
    agentId: string,
    conversationId: string,
  ) => Promise<UnbindTelegramChatResult>;
}
