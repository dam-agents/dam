import type { EnvVar } from "api-server-api";

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
  data: string; // base64-encoded
  mimeType: string; // e.g. "image/png", "image/jpeg"
}

export interface FilePart {
  kind: "file";
  name: string;
  mimeType: string;
  /** Absent when the part is a replayed reference rather than a fresh upload — */
  /** the actual bytes only exist on the agent side. */
  data?: string; // base64-encoded
  size?: number;
}

export interface UploadedFilePart extends FilePart {
  data: string;
  size: number;
}

export type Attachment = ImagePart | UploadedFilePart;

export type MessagePart =
  | TextPart
  | ThoughtPart
  | ImagePart
  | FilePart
  | ToolChip;

export interface Message {
  id: string;
  role: Role;
  parts: MessagePart[];
  streaming: boolean;
  /** True while this assistant message is waiting behind an earlier in-flight
   *  prompt on the server queue. Flipped to false when the server starts
   *  streaming content to it. */
  queued?: boolean;
  /** System-style placeholder rendered as dim centered text — used for the
   *  `<clipped-conversation>` marker the runtime injects at the start of a
   *  catch-up when the session log has been truncated. Invisible to the
   *  projection's routing (findActiveAssistant skips these). */
  notice?: boolean;
  error?: {
    message: string;
    /** Cleared once any subsequent send starts, so the Retry button only lives
     *  on the most recent failure. */
    retryWith?: { text: string; attachments?: Attachment[] };
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
  setupNote?: { title: string; body: string };
  experimental: boolean;
}

export type AgentState =
  | "starting"
  | "preparing_workspace"
  | "running"
  | "hibernating"
  | "hibernated"
  | "error";

export interface AgentView {
  id: string;
  name: string;
  templateId: string | null;
  image: string;
  description?: string;
  env?: EnvVar[];
  hibernationTimeoutMin: number;
  grantedSecretIds: string[];
  grantedConnectionIds: string[];
  state: AgentState;
  error?: string;
  /** Abnormal pod-termination cause (OOM / crash) while the pod is down; absent on normal lifecycle. */
  podTerminationReason?: string;
  /** Contributions that failed to install on the last settle; empty when healthy. */
  contributionFailures: { kind: string; message: string }[];
  channels: (
    | { type: "slack"; slackChannelId: string }
    | { type: "telegram" }
  )[];
  allowedUserEmails: string[];
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
