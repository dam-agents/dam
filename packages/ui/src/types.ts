import type { EnvMapping, EnvVar, InjectionConfig, SecretType } from "api-server-api";
import { isProviderPresetType } from "api-server-api";

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

export type MessagePart = TextPart | ThoughtPart | ImagePart | FilePart | ToolChip;

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

export interface LogEntry {
  id: string;
  ts: string;
  type: string;
  payload: object;
}

export type { SessionView } from "api-server-api";
export { SessionType } from "api-server-api";

export interface TreeEntry {
  path: string;
  type: "file" | "dir";
}

export interface TemplateView {
  id: string;
  name: string;
  image: string;
  description?: string;
}

export interface AgentView {
  id: string;
  name: string;
  templateId: string | null;
  image: string;
  description?: string;
  env?: EnvVar[];
}

export type InstanceState =
  | "starting"
  | "running"
  | "hibernating"
  | "hibernated"
  | "error";

export interface InstanceView {
  id: string;
  name: string;
  agentId: string;
  description?: string;
  state: InstanceState;
  error?: string;
  channels: ({ type: "slack"; slackChannelId: string } | { type: "telegram" })[];
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
  instanceId: string;
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

// `SecretType` is re-exported from `api-server-api` near the bottom of
// this file alongside the rest of the secrets shared types — keeping
// one source of truth so a new provider added to the api-server-api
// union can't be silently missed here.

/** Prefix used for MCP OAuth secrets stored as K8s credential Secrets. */
export const MCP_SECRET_PREFIX = "__mcp:";

/** Prefix used for app-OAuth tokens stored as K8s credential Secrets by the api-server. */
export const APP_OAUTH_SECRET_PREFIX = "__oauth:";

export function isMcpSecret(s: { name: string; type: SecretType }): boolean {
  return !isProviderPresetType(s.type) && s.name.startsWith(MCP_SECRET_PREFIX);
}

/** User-visible "Secrets" — excludes provider presets (Anthropic, IBM LiteLLM)
 *  and platform-internal mirrors (MCP OAuth blobs and app-OAuth token mirrors). */
export function isCustomSecret(s: { name: string; type: SecretType }): boolean {
  return (
    !isProviderPresetType(s.type) &&
    !s.name.startsWith(MCP_SECRET_PREFIX) &&
    !s.name.startsWith(APP_OAUTH_SECRET_PREFIX)
  );
}

export function mcpHostnameFromSecretName(name: string): string {
  return name.startsWith(MCP_SECRET_PREFIX)
    ? name.slice(MCP_SECRET_PREFIX.length)
    : name;
}

export type {
  EgressPreset,
  EnvMapping,
  EnvVar,
  IbmLitellmModelPins,
  InjectionConfig,
  ProviderPreset,
  ProviderPresetMode,
  ProviderPresetType,
  SecretType,
} from "api-server-api";
export {
  DEFAULT_ENV_PLACEHOLDER,
  DEFAULT_INJECTION_CONFIG,
  IBM_LITELLM_DEFAULT_MODEL_PINS,
  ibmLitellmEnvMappings,
  ibmLitellmPinsFromEnvMappings,
  isProviderPresetType,
  isValidEnvName,
  PROVIDER_PRESET_TYPES,
  PROVIDERS,
} from "api-server-api";

export interface SecretView {
  id: string;
  name: string;
  type: SecretType;
  hostPattern: string;
  pathPattern?: string;
  injectionConfig?: InjectionConfig;
  createdAt: string;
  envMappings?: EnvMapping[];
}

export interface McpConnection {
  hostname: string;
  connectedAt: string;
  expired: boolean;
}
