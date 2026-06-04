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

// The public projection of the Agent CR spec: the generated AgentSpecCR (the
// Go-authored CRD is the single source, ADR-058) with name guaranteed (the CRD
// marks it optional). Layer A fields (security context, scheduling, pod
// metadata) are chart-only and never in the CRD spec, so they're absent here
// too (ADR-042). The connection/secret grants are api-server-written spec
// intent (ADR-058), so they belong in the spec.
export type AgentSpec = AgentSpecCR & { name: string };

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

export type AgentCreateInput = z.infer<typeof agentCreateInputSchema>;
export type AgentUpdateInput = z.infer<typeof agentUpdateInputSchema>;

export type ConnectSlackError =
  | { type: "AgentNotFound" }
  | { type: "ChannelAlreadyBound" };

export type ConnectSlackResult =
  | { ok: true; value: Agent }
  | { ok: false; error: ConnectSlackError };

export interface AgentsService {
  list: () => Promise<Agent[]>;
  get: (id: string) => Promise<Agent | null>;
  create: (input: AgentCreateInput) => Promise<Agent>;
  update: (input: AgentUpdateInput) => Promise<Agent | null>;
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
