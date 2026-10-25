import type { RuntimeFeatures } from "agent-runtime-api";
import type { z } from "zod";
import { ChannelType } from "../shared.js";
import type { AgentPermission } from "./permissions.js";
import type { AgentSpecCR } from "../../crd-types.gen.js";
import type {
  KitUpdatePending,
  OnboardingStep,
  SeedStamp,
} from "../starter-kits/types.js";
import type {
  agentCreateInputSchema,
  agentKindSchema,
  agentPatchSchema,
} from "./schemas.js";

export { ChannelType };

export const PROTECTED_AGENT_ENV_NAMES: readonly string[] = ["PORT"];

export function isProtectedAgentEnvName(name: string): boolean {
  return PROTECTED_AGENT_ENV_NAMES.includes(name);
}

// UNIT_BOUNDARY_DESCRIPTION: the termination codes clients word for themselves. A view's code stays a string, since the controller can add one, but a client compares against these names, so a typo or a removed code fails to compile.
export const TerminationCode = {
  OutOfMemory: "OutOfMemory",
  RunnerOutOfMemory: "RunnerOutOfMemory",
  HomeVolumeFull: "HomeVolumeFull",
  MachineStorageFull: "MachineStorageFull",
  MachineImageUnavailable: "MachineImageUnavailable",
  MachineImageCacheUnreachable: "MachineImageCacheUnreachable",
  MachineBootFailed: "MachineBootFailed",
  MachineRunnerUnschedulable: "MachineRunnerUnschedulable",
  MachineRunnerNodeLost: "MachineRunnerNodeLost",
  MachineAllocationUnreadable: "MachineAllocationUnreadable",
  ImagePullFailure: "ImagePullFailure",
  InvalidImageName: "InvalidImageName",
  ContainerTerminated: "ContainerTerminated",
} as const;

// UNIT_BOUNDARY_DESCRIPTION: termination codes that mean the agent was refused a start rather than crashed, so every client says it "can't start" for the same codes.
const START_REFUSAL_CODES: ReadonlySet<string> = new Set([
  TerminationCode.MachineStorageFull,
  TerminationCode.HomeVolumeFull,
  TerminationCode.MachineImageUnavailable,
  TerminationCode.MachineImageCacheUnreachable,
  TerminationCode.MachineBootFailed,
  TerminationCode.MachineRunnerUnschedulable,
  TerminationCode.MachineRunnerNodeLost,
  TerminationCode.MachineAllocationUnreadable,
  TerminationCode.ImagePullFailure,
  TerminationCode.InvalidImageName,
]);

// UNIT_BOUNDARY_DESCRIPTION: the body the api-server answers a call through an agent with when it could not wake the agent, in place of the agent's own answer. `message` is the sentence the web app shows for the same failure.
export const AGENT_UNREACHABLE = "agent unreachable";
export interface AgentUnreachableBody {
  error: typeof AGENT_UNREACHABLE;
  reason?: string;
  message?: string;
}

export function isStartRefusal(code: string | undefined): boolean {
  return code !== undefined && START_REFUSAL_CODES.has(code);
}

export interface Channel {
  type: ChannelType;
}

export type SlackConversationLabel =
  | { kind: "channel"; name: string }
  | { kind: "direct-message"; with: string | null }
  | { kind: "group-direct-message"; members: string[] }
  | { kind: "gone" };

export interface SlackLoopGuardDrop {
  at: string;
  thread: boolean;
  sender: "agent" | "app";
  name: string;
}

// UNIT_BOUNDARY_DESCRIPTION: the bot and app posts the loop guard dropped in one Slack conversation in the day since its last drop; `recent` holds the newest few, newest first.
export interface SlackLoopGuardDrops {
  limit: number;
  dropped: number;
  lastDroppedAt: string;
  recent: SlackLoopGuardDrop[];
}

export interface SlackChannel extends Channel {
  type: ChannelType.Slack;
  slackChannelId: string;
  teamId?: string;
  label?: SlackConversationLabel;
  ambient?: boolean;
  default?: boolean;
  customEmoji?: string[] | null;
  loopGuard?: SlackLoopGuardDrops;
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
  startFailed?: boolean;
}

export type WorkspaceMutationKind = "workspace-seed" | "workspace-command";

export interface WorkspaceFailure {
  kind: WorkspaceMutationKind;
  error: string;
  settled: boolean;
  attempts: number;
  maxAttempts: number;
}

export interface AgentReclaim {
  at: string;
  for: "memory" | "compute";
}

export interface AgentStartFailure {
  reason: string;
  message: string;
}

export interface Agent {
  id: string;
  name: string;
  createdAt?: string;
  templateId?: string;
  templateUpdate?: TemplateUpdate;
  spec: AgentSpec;
  state: AgentState;
  effectiveHibernationTimeoutMin: number;
  error?: string;
  stopRequested: boolean;
  disabled: boolean;
  overBudget: boolean;
  overBudgetMessage?: string;
  reclaimed?: AgentReclaim;
  podTerminationReason?: string;
  podTerminationCode?: string;
  notReadyMessage?: string;
  startFailure?: AgentStartFailure;
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
  starterKitDefaultModel?: string;
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
  starterKitDefaultModel?: string;
  id?: string;
  telemetryAttributionId?: string;
  noDefaultProvider?: boolean;
  environmentOf?: string;
};
export type AgentUpdateInput = z.infer<typeof agentPatchSchema>;

export interface BackgroundWorkItemView {
  id: string;
  description?: string;
  command?: string;
}

export interface SessionBackgroundWork {
  sessionId: string;
  items: BackgroundWorkItemView[];
}

export interface AgentBackgroundWork {
  sessions: SessionBackgroundWork[];
  keptProcesses: number;
  // UNIT_BOUNDARY_DESCRIPTION: Environment Links open on this machine, which hold it awake as kept work does.
  openLinks: number;
}

export type UpgradeAgentError =
  | { type: "AgentNotFound" }
  | { type: "TemplateNotFound" }
  | { type: "TemplateMoved" };

export type UpgradeAgentResult =
  { ok: true; value: Agent } | { ok: false; error: UpgradeAgentError };

export type WakeAgentError =
  { type: "AgentNotFound" } | { type: "AgentDisabled" };

export type SetAgentDisabledError = { type: "AgentNotFound" };

export type SetAgentDisabledResult =
  { ok: true; value: Agent } | { ok: false; error: SetAgentDisabledError };

export type WakeAgentResult =
  { ok: true; value: Agent } | { ok: false; error: WakeAgentError };

export type ConnectSlackError =
  | { type: "AgentNotFound" }
  | { type: "ChannelAlreadyBound" }
  | { type: "WorkspaceUnresolved" }
  | { type: "WorkspaceUnreachable" }
  | { type: "NoSlackWorkspace" }
  | { type: "SlackAccountUnlinked" }
  | { type: "NotChannelMember" }
  | { type: "MembershipUnchecked" };

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
  direct: boolean;
}

export type ListTelegramChatsResult =
  | { ok: true; value: { chats: TelegramChatView[] } }
  | { ok: false; error: ListTelegramChatsError };

export type UnbindTelegramChatError =
  { type: "AgentNotFound" } | { type: "ChatNotFound" };

export type UnbindTelegramChatResult =
  { ok: true; value: null } | { ok: false; error: UnbindTelegramChatError };

export interface RuntimeFleetAgent {
  agentId: string;
  name: string;
  image: string;
  templateImage: string;
  lastHello: string | null;
}

export interface RuntimeFleet {
  onCurrent: number;
  outdated: RuntimeFleetAgent[];
}

export type AgentAccess =
  | { role: "owner"; editors: string[]; permissions: AgentPermission[] }
  | {
      role: "editor";
      ownerEmail: string | null;
      editors: string[];
      permissions: AgentPermission[];
    };

export interface AgentWithAccess {
  agent: Agent;
  access: AgentAccess;
}

export type AgentListScope = "mine" | "all";

export type SetAgentEditorsError =
  { type: "AgentNotFound" } | { type: "OwnEmail" };

export type SetAgentEditorsResult =
  { ok: true; value: string[] } | { ok: false; error: SetAgentEditorsError };

export type LeaveAgentError =
  { type: "AgentNotFound" } | { type: "NotAnEditor" };

export type LeaveAgentResult =
  { ok: true; value: { name: string } } | { ok: false; error: LeaveAgentError };

export interface AgentsService {
  list: () => Promise<Agent[]>;
  listWithAccess: (scope: AgentListScope) => Promise<AgentWithAccess[]>;
  getWithAccess: (id: string) => Promise<AgentWithAccess | null>;
  setEditors: (id: string, editors: string[]) => Promise<SetAgentEditorsResult>;
  leave: (id: string) => Promise<LeaveAgentResult>;
  runtimeFleet: (agentIds?: readonly string[]) => Promise<RuntimeFleet>;
  get: (id: string) => Promise<Agent | null>;
  backgroundWork: (id: string) => Promise<AgentBackgroundWork | null>;
  create: (input: AgentCreateInput) => Promise<Agent>;
  update: (input: AgentUpdateInput) => Promise<Agent | null>;
  delete: (id: string) => Promise<void>;
  restart: (id: string) => Promise<boolean>;
  wake: (id: string) => Promise<WakeAgentResult>;
  retryWorkspace: (
    id: string,
    kind: WorkspaceMutationKind,
  ) => Promise<Agent | null>;
  sleep: (id: string) => Promise<Agent | null>;
  setDisabled: (
    id: string,
    disabled: boolean,
  ) => Promise<SetAgentDisabledResult>;
  upgrade: (
    id: string,
    expectedToImage?: string,
  ) => Promise<UpgradeAgentResult>;
  ensureReady: (id: string, opts?: { onWaking?: () => void }) => Promise<void>;
  connectSlack: (
    id: string,
    slackChannelId: string,
    ambient?: boolean,
    customEmoji?: string[] | null,
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
  ) => Promise<{ chatTitle: string | null; direct: boolean } | null>;
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
