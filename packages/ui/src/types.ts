import type { PromptBlock } from "api-server-api";
import type { AgentKind, EnvVar } from "api-server-api";

export type Role = "user" | "assistant";

export interface ToolContent {
  type: "content" | "diff" | "terminal";
  text?: string;
}

export interface ToolChip {
  kind: "tool";
  toolCallId?: string;
  title: string;
  status: string;
  content?: ToolContent[];
}

export interface TextPart {
  kind: "text";
  text: string;
}

export interface ThoughtPart {
  kind: "thought";
  text: string;
}

export interface ImagePart {
  kind: "image";
  data: string;
  mimeType: string;
}

export interface FilePart {
  kind: "file";
  name: string;
  mimeType: string;
  data?: string;
  size?: number;
}

export interface UploadedFilePart extends FilePart {
  data: string;
  size: number;
}

export type Attachment = ImagePart | UploadedFilePart;

export interface RetryPayload {
  text: string;
  attachments?: Attachment[];
  blocks?: PromptBlock[];
}

export interface VerdictPart {
  kind: "verdict";
  label: string;
  subject: string;
  allowed: boolean;
}

export type MessagePart =
  | TextPart
  | ThoughtPart
  | ImagePart
  | FilePart
  | ToolChip
  | VerdictPart;

export interface Message {
  id: string;
  role: Role;
  parts: MessagePart[];
  streaming: boolean;
  queued?: boolean;
  promptId?: string;
  retryWith?: RetryPayload;
  notice?: boolean;
  loadOlderBefore?: string;
  error?: {
    message: string;
    retryWith?: RetryPayload;
  };
}

export type { SessionView } from "api-server-api";
export { SessionType } from "api-server-api";

export interface TemplateView {
  id: string;
  name: string;
  image: string;
  description?: string;
  category: "harness" | "preconfigured";
  tags?: string[];
  docsUrl?: string;
  releaseNotesUrl?: string;
  setupNote?: { title: string; body: string };
  experimental: boolean;
  vm: boolean;
  size?: { cpu?: string; memory?: string };
}

export type AgentState =
  | "starting"
  | "preparing_workspace"
  | "running"
  | "hibernating"
  | "hibernated"
  | "over_budget"
  | "error";

export interface AgentView {
  id: string;
  name: string;
  templateId: string | null;
  templateUpdate: { fromImage: string; toImage: string } | null;
  features: { liveUpdates: boolean };
  image: string;
  description?: string;
  env?: EnvVar[];
  hibernationTimeoutMin: number;
  grantedSecretIds: string[];
  grantedConnectionIds: string[];
  state: AgentState;
  error?: string;
  stopRequested: boolean;
  overBudget: boolean;
  overBudgetMessage?: string;
  size: { cpu?: string; memory?: string };
  podTerminationReason?: string;
  contributionFailures: { kind: string; message: string }[];
  channels: (
    | {
        type: "slack";
        slackChannelId: string;
        ambient?: boolean;
        default?: boolean;
      }
    | { type: "telegram" }
  )[];
  kbTemplateId: string | null;
  spawnedBy: string | null;
  kind?: AgentKind;
}

export interface QuietWindowView {
  startTime: string;
  endTime: string;
  enabled: boolean;
}

export interface Schedule {
  id: string;
  name: string;
  agentId: string;
  type: "cron" | "rrule";
  cron: string | null;
  rrule: string | null;
  timezone: string | null;
  quietHours: QuietWindowView[];
  task: string | null;
  enabled: boolean;
  sessionMode?: "continuous" | "fresh";
  createdBy: "user" | "agent";
  status: { lastRun?: string; nextRun?: string; lastResult?: string } | null;
}

export type {
  BobModelPins,
  EgressPreset,
  EnvMapping,
  EnvVar,
  InjectionConfig,
  ProviderPreset,
  ProviderPresetMode,
  ProviderPresetType,
} from "api-server-api";
export {
  BOB_CHAT_MODES,
  DEFAULT_ENV_PLACEHOLDER,
  isProviderPresetType,
  isValidEnvName,
  PROVIDER_PRESET_TYPES,
  PROVIDERS,
} from "api-server-api";

export interface McpConnection {
  hostname: string;
  connectedAt: string;
  expired: boolean;
}
