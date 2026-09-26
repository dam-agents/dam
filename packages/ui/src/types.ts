import type { PromptBlock, ProviderPresetType } from "api-server-api";
import type {
  AgentKind,
  EnvVar,
  HarnessFamily,
  SlackChannel,
} from "api-server-api";

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

interface TextPart {
  kind: "text";
  text: string;
}

interface ThoughtPart {
  kind: "thought";
  text: string;
}

interface HistoryPart {
  kind: "history";
  text: string;
}

interface ImagePart {
  kind: "image";
  data: string;
  mimeType: string;
}

interface FilePart {
  kind: "file";
  name: string;
  mimeType: string;
  data?: string;
  size?: number;
}

interface UploadedFilePart extends FilePart {
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
  | HistoryPart
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
  at?: string;
  telemetryPromptId?: string;
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
  category: "harness";
  harness?: HarnessFamily;
  providers?: ProviderPresetType[];
  tags?: string[];
  docsUrl?: string;
  releaseNotesUrl?: string;
  setupNote?: { title: string; body: string };
  experimental: boolean;
  size?: { cpu?: string; memory?: string };
}

export interface OnboardingStep {
  id: string;
  label: string;
  done: boolean;
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
  createdAt?: string;
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
  podRestarts: number;
  podRestartReason?: string;
  contributionFailures: { kind: string; message: string }[];
  unsupportedContributionKinds: string[];
  workspaceFailures: {
    kind: string;
    error: string;
    settled: boolean;
    attempts: number;
    maxAttempts: number;
  }[];
  channels: SlackChannel[];
  kbTemplateId: string | null;
  kbShareRoots?: string[];
  starterKit: string | null;
  starterKitOnboarded: string | null;
  onboardingSteps?: OnboardingStep[];
  spawnedBy: string | null;
  vm: boolean;
  kind?: AgentKind;
}

interface QuietWindowView {
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
  precheck: string | null;
  enabled: boolean;
  sessionMode?: "continuous" | "fresh";
  createdBy: "user" | "agent";
  status: {
    lastRun?: string;
    nextRun?: string;
    lastResult?: string;
    lastDeclinedAt?: string;
    declinedCount?: number;
    lastPrecheckError?: string;
    precheckFailedCount?: number;
  } | null;
}

export type {
  BobModelPins,
  EgressPreset,
  EnvVar,
  ProviderPresetType,
} from "api-server-api";
export { BOB_CHAT_MODES, isValidEnvName, PROVIDERS } from "api-server-api";
