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

/** Client-minted record of a tool-approval verdict, anchored where the user
 *  decided it. Not part of the runtime log — it vanishes on session replay. */
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
  /** Backed by a KubeVirt VM rather than a pod — the image is a containerDisk,
   *  so this is a property of the template, never a per-sandbox override. */
  vm: boolean;
  /** The template's default Size (#1900): CPU/memory limit strings. */
  size?: { cpu?: string; memory?: string };
}

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

export interface AgentView {
  id: string;
  name: string;
  templateId: string | null;
  /** Present when the sandbox is behind its template (#1077): the template
   *  now ships a different image than the one captured at create time. */
  templateUpdate: { fromImage: string; toImage: string } | null;
  image: string;
  description?: string;
  env?: EnvVar[];
  hibernationTimeoutMin: number;
  grantedSecretIds: string[];
  grantedConnectionIds: string[];
  state: AgentState;
  error?: string;
  /** Parked (#1900): starting would breach the owner's compute budget; the
   *  sandbox stays parked until you free room and start it. */
  overBudget: boolean;
  /** The controller's figures for a parked sandbox (tooltip copy). */
  overBudgetMessage?: string;
  /** The sandbox's Size (#1900): its CPU/memory limit strings. */
  size: { cpu?: string; memory?: string };
  /** Abnormal pod-termination cause (OOM / crash) while the pod is down; absent on normal lifecycle. */
  podTerminationReason?: string;
  /** Contributions that failed to install on the last settle; empty when healthy. */
  contributionFailures: { kind: string; message: string }[];
  channels: (
    | {
        type: "slack";
        slackChannelId: string;
        /** Access mode; absent = person-scoped. */
        mode?: "shared" | "person-scoped";
        /** Ambient mode (shared only): the agent reads along and may chime
         *  in without being mentioned; absent = off. */
        ambient?: boolean;
      }
    | { type: "telegram" }
  )[];
  allowedUserEmails: string[];
  /** The KB template a Knowledge Base was created from. Null on plain
   *  sandboxes and on Knowledge Bases created before the id was stamped. */
  kbTemplateId: string | null;
  /** The driver that spawned this agent as an Invocation target; null for
   *  every agent the user created. Targets are run-owned and ephemeral, so the
   *  list hides them and accounts for their compute on the driver's row. */
  spawnedBy: string | null;
  /** Which first-class surface this agent also belongs to (a Knowledge Base and
   *  an experiment sandbox are each an agent plus this marker). Absent on plain
   *  sandboxes. The Sandboxes list shows every agent badged with its kind; the
   *  per-kind destinations are filtered views onto the same agents. */
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
