import type { z } from "zod";
import { ChannelType } from "../shared.js";
import type { AgentSpecCR } from "../../crd-types.gen.js";
import type {
  agentCreateInputSchema,
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
  /** Access mode of the binding; absent = person-scoped. */
  mode?: "shared" | "person-scoped";
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

export interface Agent {
  id: string;
  name: string;
  templateId?: string;
  spec: AgentSpec;
  /** Observed lifecycle state, synthesized from the controller's status.yaml. */
  state: AgentState;
  /** Effective idle timeout in minutes (0 = never): the per-agent override (spec.hibernationTimeout) resolved against the global default. */
  effectiveHibernationTimeoutMin: number;
  /** Latest controller-reported error, if any. */
  error?: string;
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
  /** Emails of users (other than the owner) allowed to message this agent
   *  from a connected channel. */
  allowedUserEmails: string[];
}

export type AgentCreateInput = z.infer<typeof agentCreateInputSchema>;
export type AgentUpdateInput = z.infer<typeof agentUpdateInputSchema>;

export type ConnectSlackError =
  | { type: "AgentNotFound" }
  | { type: "ChannelAlreadyBound" }
  /** Mode is fixed per binding: switching requires disconnect + reconnect. */
  | { type: "ModeChangeRequiresRebind" };

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
    mode?: "shared" | "person-scoped",
  ) => Promise<ConnectSlackResult>;
  disconnectSlack: (id: string) => Promise<Agent | null>;
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
   *  the in-chat /logout). */
  unbindTelegramChat: (
    agentId: string,
    conversationId: string,
  ) => Promise<UnbindTelegramChatResult>;
  isAllowedUser: (agentId: string, keycloakSub: string) => Promise<boolean>;
}
