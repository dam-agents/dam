import type { RuntimeFeatures } from "agent-runtime-api";
import type { z } from "zod";
import { ChannelType } from "../shared.js";
import type { AgentSpecCR } from "../../crd-types.gen.js";
import type {
  KitUpdatePending,
  OnboardingStep,
  SeedStamp,
} from "../starter-kits/types.js";
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

export type SlackConversationLabel =
  | { kind: "channel"; name: string }
  | { kind: "direct-message"; with: string | null }
  | { kind: "group-direct-message"; members: string[] }
  | { kind: "gone" };

export interface SlackChannel extends Channel {
  type: ChannelType.Slack;
  slackChannelId: string;
  teamId?: string;
  label?: SlackConversationLabel;
  ambient?: boolean;
  default?: boolean;
}

export type ChannelConfig = SlackChannel;

export type AgentState =
  | "starting"
  | "preparing_workspace"
  | "running"
  | "hibernating"
  | "hibernated"
  | "over_budget"
  | "migrating"
  | "error";

export type AgentSpec = AgentSpecCR & { name: string };

export interface TemplateUpdate {
  fromImage: string;
  toImage: string;
}

export type RuntimeMigrationPhase =
  | "requested"
  | "stopping"
  | "copying"
  | "booting"
  | "verified"
  | "failed"
  | "aborting";

export interface RuntimeMigration {
  phase: RuntimeMigrationPhase;
  message?: string;
  attempts?: number;
  abortable: boolean;
  retryable: boolean;
}

export type WorkspaceMutationKind = "workspace-seed" | "workspace-command";

export interface WorkspaceFailure {
  kind: WorkspaceMutationKind;
  error: string;
  settled: boolean;
  attempts: number;
  maxAttempts: number;
}

export interface Agent {
  id: string;
  name: string;
  createdAt?: string;
  templateId?: string;
  templateUpdate?: TemplateUpdate;
  runtimeMigration?: RuntimeMigration;
  runtimeMigratable?: boolean;
  spec: AgentSpec;
  state: AgentState;
  effectiveHibernationTimeoutMin: number;
  error?: string;
  stopRequested: boolean;
  overBudget: boolean;
  overBudgetMessage?: string;
  podTerminationReason?: string;
  notReadyMessage?: string;
  podRestarts: number;
  podRestartReason?: string;
  gatewayFailure?: string;
  contributionFailures: { kind: string; message: string }[];
  unsupportedContributionKinds: string[];
  workspaceFailures: WorkspaceFailure[];
  channels: ChannelConfig[];
  kind?: AgentKind;
  kbTemplateId?: string;
  kbShareRoots?: string[];
  starterKit?: string;
  starterKitOnboarded?: string;
  starterKitSeed?: SeedStamp;
  kitUpdatePending?: KitUpdatePending;
  kitUpdateSkipped?: string;
  onboardingSteps?: OnboardingStep[];
  features: RuntimeFeatures;
}

export type AgentKind = z.infer<typeof agentKindSchema>;
export type AgentCreateInput = z.infer<typeof agentCreateInputSchema> & {
  kind?: AgentKind;
  starterKit?: string;
  starterKitSeed?: SeedStamp;
  id?: string;
  telemetryAttributionId?: string;
  noDefaultProvider?: boolean;
};
export type AgentUpdateInput = z.infer<typeof agentUpdateInputSchema>;

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
  { ok: true; value: Agent } | { ok: false; error: UpgradeAgentError };

export type MigrateRuntimeError =
  | { type: "AgentNotFound" }
  | { type: "AlreadyOnVm" }
  | { type: "VirtualizationDisabled" }
  | { type: "RuntimeMigrationInProgress" }
  | { type: "StorageMigrationInProgress" }
  | { type: "PersistsUnmovablePaths"; paths: UnmovablePath[] }
  | { type: "HomeNotPersisted" }
  | { type: "ConcurrentUpdate" };

export interface UnmovablePath {
  path: string;
  reason: string;
}

export type RuntimeMigrationRefusal = Exclude<
  MigrateRuntimeError,
  { type: "AgentNotFound" }
>;

export interface RuntimeMigrationPlan {
  unmovable: UnmovablePath[];
  storageSize: string;
  storageResized: boolean;
  bootsSleepingAgent: boolean;
  retentionMs: number | null;
  refusal: RuntimeMigrationRefusal | null;
}

export type PlanRuntimeMigrationResult =
  | { ok: true; value: RuntimeMigrationPlan }
  | { ok: false; error: { type: "AgentNotFound" } };

export type MigrateRuntimeResult =
  { ok: true; value: Agent } | { ok: false; error: MigrateRuntimeError };

export type WakeAgentError =
  { type: "AgentNotFound" } | { type: "RuntimeMigrating"; failed: boolean };

export type WakeAgentResult =
  { ok: true; value: Agent } | { ok: false; error: WakeAgentError };

export type AbortRuntimeMigrationError =
  | { type: "AgentNotFound" }
  | { type: "NoRuntimeMigration" }
  | { type: "RuntimeMigrationVerified" }
  | { type: "ConcurrentUpdate" };

export type AbortRuntimeMigrationResult =
  { ok: true; value: Agent } | { ok: false; error: AbortRuntimeMigrationError };

export type RetryRuntimeMigrationError =
  | { type: "AgentNotFound" }
  | { type: "NoRuntimeMigration" }
  | { type: "RuntimeMigrationNotFailed" }
  | { type: "ConcurrentUpdate" };

export type RetryRuntimeMigrationResult =
  { ok: true; value: Agent } | { ok: false; error: RetryRuntimeMigrationError };

export type ConnectSlackError =
  | { type: "AgentNotFound" }
  | { type: "ChannelAlreadyBound" }
  | { type: "WorkspaceUnresolved" }
  | { type: "WorkspaceUnreachable" }
  | { type: "NoSlackWorkspace" };

export type ConnectSlackResult =
  { ok: true; value: Agent } | { ok: false; error: ConnectSlackError };

export type BindSlackChannelError =
  | { type: "FlowInvalid" }
  | { type: "AgentNotFound" }
  | { type: "ChannelAlreadyBound" }
  | { type: "WorkspaceUnresolved" }
  | { type: "WorkspaceUnreachable" }
  | { type: "NoSlackWorkspace" };

export type BindSlackChannelResult =
  | { ok: true; value: { slackChannelId: string; channelTitle: string | null } }
  | { ok: false; error: BindSlackChannelError };

export type BindTelegramChatError =
  | { type: "FlowInvalid" }
  | { type: "AgentNotFound" }
  | { type: "ChatAlreadyBound" };

export type BindTelegramChatResult =
  | { ok: true; value: { chatTitle: string | null } }
  | { ok: false; error: BindTelegramChatError };

export type ListTelegramChatsError =
  { type: "AgentNotFound" } | { type: "TelegramUnavailable" };

export interface TelegramChatView {
  conversationId: string;
  title: string;
}

export type ListTelegramChatsResult =
  | { ok: true; value: { chats: TelegramChatView[] } }
  | { ok: false; error: ListTelegramChatsError };

export type UnbindTelegramChatError =
  { type: "AgentNotFound" } | { type: "ChatNotFound" };

export type UnbindTelegramChatResult =
  { ok: true; value: null } | { ok: false; error: UnbindTelegramChatError };

export interface AgentsService {
  list: () => Promise<Agent[]>;
  get: (id: string) => Promise<Agent | null>;
  backgroundWork: (id: string) => Promise<SessionBackgroundWork[] | null>;
  create: (input: AgentCreateInput) => Promise<Agent>;
  update: (input: AgentUpdateInput) => Promise<Agent | null>;
  delete: (id: string) => Promise<void>;
  restart: (id: string) => Promise<boolean>;
  wake: (id: string) => Promise<WakeAgentResult>;
  stop: (id: string) => Promise<Agent | null>;
  retryWorkspace: (
    id: string,
    kind: WorkspaceMutationKind,
  ) => Promise<Agent | null>;
  pause: (id: string) => Promise<Agent | null>;
  upgrade: (
    id: string,
    expectedToImage?: string,
  ) => Promise<UpgradeAgentResult>;
  migrateRuntime: (id: string) => Promise<MigrateRuntimeResult>;
  planRuntimeMigration: (id: string) => Promise<PlanRuntimeMigrationResult>;
  abortRuntimeMigration: (id: string) => Promise<AbortRuntimeMigrationResult>;
  retryRuntimeMigration: (id: string) => Promise<RetryRuntimeMigrationResult>;
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
  peekSlackBindFlow: (
    flowId: string,
  ) => Promise<{ slackChannelId: string; name?: string } | null>;
  peekTelegramBindFlow: (
    flowId: string,
  ) => Promise<{ chatTitle: string | null } | null>;
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
