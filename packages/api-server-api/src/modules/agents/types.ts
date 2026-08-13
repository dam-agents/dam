import type { z } from "zod";
import { ChannelType } from "../shared.js";
import type { AgentSpecCR } from "../../crd-types.gen.js";
import type {
  agentCreateInputSchema,
  agentKindSchema,
  agentUpdateInputSchema,
} from "./schemas.js";

export { ChannelType };

export const PROTECTED_AGENT_ENV_NAMES: readonly string[] = ["PORT"];

export function isProtectedAgentEnvName(name: string): boolean {
  return PROTECTED_AGENT_ENV_NAMES.includes(name);
}

export interface Channel {
  type: ChannelType;
}

export interface SlackChannel extends Channel {
  type: ChannelType.Slack;
  slackChannelId: string;
  ambient?: boolean;
}

export type ChannelConfig = SlackChannel;

export type AgentState =
  | "starting"
  | "preparing_workspace"
  | "running"
  | "hibernating"
  | "hibernated"
  | "over_budget"
  | "error";

export type AgentSpec = AgentSpecCR & { name: string };

export interface TemplateUpdate {
  fromImage: string;
  toImage: string;
}

export interface Agent {
  id: string;
  name: string;
  templateId?: string;
  templateUpdate?: TemplateUpdate;
  spec: AgentSpec;
  state: AgentState;
  effectiveHibernationTimeoutMin: number;
  error?: string;
  stopRequested: boolean;
  overBudget: boolean;
  overBudgetMessage?: string;
  podTerminationReason?: string;
  contributionFailures: { kind: string; message: string }[];
  channels: ChannelConfig[];
  kind?: AgentKind;
  kbTemplateId?: string;
}

export type AgentKind = z.infer<typeof agentKindSchema>;
export type AgentCreateInput = z.infer<typeof agentCreateInputSchema> & {
  kind?: AgentKind;
  kbTemplateId?: string;
  id?: string;
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
  | { type: "TemplateNotFound" }
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
  | { type: "FlowInvalid" }
  | { type: "AgentNotFound" }
  | { type: "ChannelAlreadyBound" };

export type BindSlackChannelResult =
  | { ok: true; value: { channelTitle: string | null } }
  | { ok: false; error: BindSlackChannelError };

export type BindTelegramChatError =
  | { type: "FlowInvalid" }
  | { type: "AgentNotFound" }
  | { type: "ChatAlreadyBound" };

export type BindTelegramChatResult =
  | { ok: true; value: { chatTitle: string | null } }
  | { ok: false; error: BindTelegramChatError };

export type ListTelegramChatsError =
  | { type: "AgentNotFound" }
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
  stop: (id: string) => Promise<Agent | null>;
  pause: (id: string) => Promise<Agent | null>;
  upgrade: (
    id: string,
    expectedToImage?: string,
  ) => Promise<UpgradeAgentResult>;
  ensureReady: (id: string, opts?: { onWaking?: () => void }) => Promise<void>;
  connectSlack: (
    id: string,
    slackChannelId: string,
    ambient?: boolean,
  ) => Promise<ConnectSlackResult>;
  disconnectSlack: (
    id: string,
    slackChannelId?: string,
  ) => Promise<Agent | null>;
  bindSlackChannel: (
    agentId: string,
    flowId: string,
  ) => Promise<BindSlackChannelResult>;
  bindTelegramChat: (
    agentId: string,
    flowId: string,
  ) => Promise<BindTelegramChatResult>;
  listTelegramChats: (agentId: string) => Promise<ListTelegramChatsResult>;
  unbindTelegramChat: (
    agentId: string,
    conversationId: string,
  ) => Promise<UnbindTelegramChatResult>;
}
