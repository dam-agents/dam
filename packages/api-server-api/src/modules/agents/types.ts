import type { EnvVar } from "../shared.js";
import { ChannelType } from "../shared.js";
import type { EgressPreset } from "../egress-rules/types.js";
import type { Mount, Resources } from "../templates/types.js";

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
}

export interface TelegramChannel extends Channel {
  type: ChannelType.Telegram;
}

export type ChannelConfig = SlackChannel | TelegramChannel;

// --- Agent ---

export type AgentState =
  | "starting"
  | "running"
  | "hibernating"
  | "hibernated"
  | "error";

// Per ADR-042, agent spec carries Layer B + C fields only. Layer A
// (security context, scheduling, pod metadata, cluster details) is
// chart-only and applied by the controller at reconcile time.
//
// Per ADR-046, the merged Agent absorbs runtime state — `desiredState`
// (user intent: running vs. hibernated) and `secretRef` (bound credential
// Secret) — that previously lived on the Instance ConfigMap.
export interface AgentSpec {
  version: string;
  name: string;
  // Copied from template at creation:
  image: string;
  description?: string;
  mounts?: Mount[];
  init?: string;
  env?: EnvVar[];
  resources?: Resources;
  /** Overrides chart-wide imagePullPolicy. Empty = inherit. */
  imagePullPolicy?: string;
  /** Overrides chart-wide storageSize for the persistent home mount. */
  storageSize?: string;
  skillPaths?: string[];
  /** Target lifecycle state. Controller scales the StatefulSet accordingly. */
  desiredState?: "running" | "hibernated";
  /** Bound credential Secret name; consumed by the paired gateway pod (ADR-038). */
  secretRef?: string;
}

export interface Agent {
  id: string;
  name: string;
  templateId?: string;
  spec: AgentSpec;
  /** Observed lifecycle state, synthesized from the controller's status.yaml. */
  state: AgentState;
  /** Latest controller-reported error, if any. */
  error?: string;
  /** External communication pathways bound to this agent. */
  channels: ChannelConfig[];
  /** Emails of users (other than the owner) allowed to message this agent
   *  from a connected channel. */
  allowedUserEmails: string[];
}

export interface CreateAgentInput {
  name: string;
  templateId?: string;
  image?: string;
  description?: string;
  env?: EnvVar[];
  secretRef?: string;
  allowedUserEmails?: string[];
  /** Transient: bulk-seeds egress_rules at create time and is then
   *  forgotten. The preset is not stored on the agent spec — its `source`
   *  on the seeded rules is the truth. Defaults to `trusted` so a
   *  brand-new agent can reach Anthropic, npm, PyPI, GitHub, etc. without
   *  per-host inbox prompts. To switch presets later, call
   *  `egressRules.applyPreset`. */
  egressPreset?: EgressPreset;
}

export interface UpdateAgentInput {
  id: string;
  name?: string;
  description?: string;
  env?: EnvVar[];
  secretRef?: string;
  allowedUserEmails?: string[];
}

export type ConnectSlackError =
  | { type: "AgentNotFound" }
  | { type: "ChannelAlreadyBound" };

export type ConnectSlackResult =
  | { ok: true; value: Agent }
  | { ok: false; error: ConnectSlackError };

export interface AgentsService {
  list: () => Promise<Agent[]>;
  get: (id: string) => Promise<Agent | null>;
  create: (input: CreateAgentInput) => Promise<Agent>;
  update: (input: UpdateAgentInput) => Promise<Agent | null>;
  delete: (id: string) => Promise<void>;
  restart: (id: string) => Promise<boolean>;
  wake: (id: string) => Promise<Agent | null>;
  /**
   * Ensure the agent's pod is reachable. Waits for pod Ready, waking
   * from hibernation if needed. Idempotent; single-flight per id; bumps
   * `agent-platform.ai/last-activity` on every success. Channel adapters
   * and any server-side caller that needs to talk to the agent must await
   * this before connecting. See ADR-032.
   */
  ensureReady: (id: string) => Promise<void>;
  connectSlack: (
    id: string,
    slackChannelId: string,
  ) => Promise<ConnectSlackResult>;
  disconnectSlack: (id: string) => Promise<Agent | null>;
  connectTelegram: (id: string, botToken: string) => Promise<Agent | null>;
  disconnectTelegram: (id: string) => Promise<Agent | null>;
  isAllowedUser: (agentId: string, keycloakSub: string) => Promise<boolean>;
}
