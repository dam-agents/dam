import type { SessionPair } from "api-server-api";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { match } from "ts-pattern";
import {
  AUTH_ERROR_HINT,
  platformRunResultResponseSchema,
  servesSteeringSupported,
  STEER_METHOD,
  steerResponseSchema,
  type AcpPermissionOption,
} from "api-server-api";
import { NO_MODEL_REASON, PIN_MODEL_METHOD } from "agent-runtime-api";
import { z } from "zod";
import {
  client,
  type AnyMessage,
  type ClientConnection,
  type ContentBlock,
  type InitializeResponse,
  type McpServer,
  type NewSessionRequest,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type Stream,
} from "@agentclientprotocol/sdk";
import { agentServiceAddress } from "../modules/agents/infrastructure/k8s.js";
import type { RunBoundary } from "../modules/harness-config/domain/run-boundary.js";
import { getLogger } from "./logger.js";
import { isPlatformMcpTool } from "./platform-mcp.js";
import { securityLog } from "./security-log.js";

const PING_INTERVAL_MS = 30_000;
const MAX_MISSED_PONGS = 2;
const STALL_PROBE_RPC_TIMEOUT_MS = 15_000;
const TURN_STATUS_DEADLINE_MS = 20_000;
const RUN_RESULT_METHOD = "platform/runResult";

export class AcpSessionLoadError extends Error {
  constructor(message: string, opts?: { cause?: unknown }) {
    super(message, opts);
    this.name = "AcpSessionLoadError";
  }
}

export type AcpTurnAbandonCause = "connection-lost" | "stalled";

export class AcpTurnAbandonedError extends Error {
  constructor(
    readonly abandonCause: AcpTurnAbandonCause,
    message: string,
  ) {
    super(message);
    this.name = "AcpTurnAbandonedError";
  }
}

export const MODEL_REFUSAL_STOP_REASON = "refusal";

export class AcpModelRefusedError extends Error {
  constructor(readonly sessionId: string) {
    super(`the model refused the prompt in session ${sessionId}`);
    this.name = "AcpModelRefusedError";
  }
}

const MODEL_ERROR_TEXT_CAP = 300;

const AUTH_REQUIRED_CODE = -32000;

const AUTH_REQUIRED_MESSAGE = "Authentication required";

const INTERNAL_ERROR_PREFIX = /^Internal error:\s*/;

const MODEL_REQUEST_FAILED = "Model request failed:";

const CLAUDE_API_ERROR_TEXT = /^(?:Failed to authenticate\. )?API Error\b/;

const PROVIDER_ERROR_KINDS: ReadonlyMap<string, ModelCallFailureKind> =
  new Map([
    ["authentication_failed", "rejected"],
    ["oauth_org_not_allowed", "rejected"],
    ["verification_required", "rejected"],
    ["cloud_credential_error", "rejected"],
    ["billing_error", "rejected"],
    ["account_on_hold", "rejected"],
    ["model_not_found", "rejected"],
    ["invalid_request", "failed"],
    ["rate_limit", "failed"],
    ["overloaded", "failed"],
    ["max_output_tokens", "failed"],
    ["server_error", "failed"],
    ["unknown", "failed"],
  ]);

export type ModelCallFailureKind = "rejected" | "failed";

/**
 * UNIT_BOUNDARY_DESCRIPTION: a turn that ended because the harness's model
 * call failed, with the provider's own words where the harness gave them.
 * `rejected` is the provider refusing the key or the access to the model,
 * which a retry does not change; `failed` is any other error from the call.
 */
export class AcpModelCallFailedError extends Error {
  constructor(
    readonly sessionId: string,
    readonly failure: ModelCallFailureKind,
    readonly providerText: string | null,
    opts?: { cause?: unknown },
  ) {
    super(
      `the model call failed in session ${sessionId}${providerText ? `: ${providerText}` : ""}`,
      opts,
    );
    this.name = "AcpModelCallFailedError";
  }
}

const RUNTIME_AUTH_HINT = `${AUTH_ERROR_HINT}\n\nError: `;

function oneLine(text: string): string | null {
  const line = text.replace(/\s+/g, " ").trim();
  if (line === "") return null;
  return line.length > MODEL_ERROR_TEXT_CAP
    ? `${line.slice(0, MODEL_ERROR_TEXT_CAP)}…`
    : line;
}

function claudeApiErrorText(lastMessage: string): string | null {
  const text = (
    lastMessage.startsWith(RUNTIME_AUTH_HINT)
      ? lastMessage.slice(RUNTIME_AUTH_HINT.length)
      : lastMessage
  ).trim();
  return CLAUDE_API_ERROR_TEXT.test(text) ? oneLine(text) : null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: reads a failed `session/prompt` as a failed
 * model call, or as no such thing. Claude Code answers a key or access the
 * provider rejected with ACP's bare `Authentication required`, and its only
 * copy of the provider's words is the turn's last message, so they are read
 * from there when that message reads as an API error, and never otherwise:
 * the agent's own prose is not the provider's. Any other failed call it names
 * after the internal error's prefix, tagged with the provider's `errorKind`.
 * Pi and Codex name it in `data.details`, after `Model request failed:`. The
 * platform's own refusals and a harness's internal failures carry none of
 * these marks and stay what they were.
 */
export function modelCallFailure(
  err: unknown,
  lastMessage: string,
): { failure: ModelCallFailureKind; providerText: string | null } | null {
  if (err === null || typeof err !== "object") return null;
  const { code, message, data } = err as {
    code?: unknown;
    message?: unknown;
    data?: { errorKind?: unknown; details?: unknown } | null;
  };
  if (typeof message !== "string") return null;
  if (code === AUTH_REQUIRED_CODE && message === AUTH_REQUIRED_MESSAGE)
    return {
      failure: "rejected",
      providerText: claudeApiErrorText(lastMessage),
    };
  const details = typeof data?.details === "string" ? data.details : "";
  if (details.startsWith(MODEL_REQUEST_FAILED))
    return {
      failure: "failed",
      providerText: oneLine(details.slice(MODEL_REQUEST_FAILED.length)),
    };
  const kind =
    typeof data?.errorKind === "string"
      ? PROVIDER_ERROR_KINDS.get(data.errorKind)
      : undefined;
  if (kind !== undefined)
    return {
      failure: kind,
      providerText: oneLine(message.replace(INTERNAL_ERROR_PREFIX, "")),
    };
  return null;
}

type ConnectionWatch =
  | { kind: "deadline"; ms: number }
  | {
      kind: "turn";
      stallProbeMs: number;
      sessionId: () => string | null;
    };

async function probeTurnStatus(
  connection: ClientConnection,
  sessionId: string,
): Promise<AcpTurnStatus> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raw = await Promise.race([
      connection.agent.request(RUN_RESULT_METHOD, { sessionId }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("stall probe timed out")),
          STALL_PROBE_RPC_TIMEOUT_MS,
        );
      }),
    ]);
    const parsed = platformRunResultResponseSchema.safeParse(raw);
    if (!parsed.success) return "unknown";
    if (parsed.data.status === "pending") return "pending";
    if (parsed.data.status === "interrupted") return "interrupted";
    return "ended";
  } catch {
    return "unknown";
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

interface ClientHandlers {
  requestPermission: (
    params: RequestPermissionRequest,
  ) => Promise<RequestPermissionResponse>;
  sessionUpdate?: (params: SessionNotification) => Promise<void>;
}

function connectClient(
  stream: Stream,
  handlers: ClientHandlers,
): ClientConnection {
  return client()
    .onRequest("session/request_permission", (ctx) =>
      handlers.requestPermission(ctx.params),
    )
    .onNotification("session/update", async (ctx) => {
      await handlers.sessionUpdate?.(ctx.params);
    })
    .onRequest("fs/write_text_file", () => ({}))
    .onRequest("fs/read_text_file", () => ({ content: "" }))
    .connect(stream);
}

function wsStream(
  url: string,
  agentId: string,
): Promise<{ stream: Stream; ws: WebSocket }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on("open", () => {
      const readable = new ReadableStream<AnyMessage>({
        start(controller) {
          ws.on("message", (data) => {
            if (ws.readyState !== WebSocket.OPEN) return;
            const text = data.toString();
            let frame: AnyMessage;
            try {
              frame = JSON.parse(text) as AnyMessage;
            } catch {
              getLogger().warn(
                { agentId, frameLength: text.length },
                "acp frame is not JSON; closing the connection",
              );
              ws.close(1007, "invalid JSON frame");
              return;
            }
            try {
              controller.enqueue(frame);
            } catch {}
          });
          ws.on("close", () => {
            try {
              controller.close();
            } catch {}
          });
          ws.on("error", (err) => {
            try {
              controller.error(err);
            } catch {}
          });
        },
      });
      const writable = new WritableStream<AnyMessage>({
        write(chunk) {
          ws.send(JSON.stringify(chunk));
        },
        close() {
          ws.close();
        },
      });
      resolve({ stream: { readable, writable }, ws });
    });
    ws.on("error", reject);
  });
}

export interface PlatformSessionMeta {
  mode?: string;
  type?: string;
  scheduleId?: string;
  initialization?: boolean;
  threadTs?: string;
  createdAt?: string;
  customTitle?: string;
  harness?: string;
  provider?: string;
  model?: string;
  settings?: Record<string, string>;
  title?: string;
}

export interface AcpSessionInfo {
  sessionId: string;
  title?: string | null;
  updatedAt?: string | null;
  platform?: PlatformSessionMeta | null;
}

const platformSessionMetaSchema = z.object({
  mode: z.string().optional(),
  type: z.string().optional(),
  scheduleId: z.string().optional(),
  initialization: z.boolean().optional(),
  threadTs: z.string().optional(),
  createdAt: z.string().optional(),
  customTitle: z
    .string()
    .nullish()
    .transform((title) => title ?? undefined),
});

export interface TriggerSessionResult {
  sessionId: string;
  stopReason?: string;
}

export type SteerOutcome =
  "injected" | "no-running-turn" | "unsupported" | "failed";

export interface SteerOpts {
  promptId: string;
  targetPromptId: string;
  signal?: AbortSignal;
}

type SessionAttach =
  | { resumeSessionId: string }
  | { onSessionCreated: (sessionId: string) => Promise<void> };

export type PromptUpdate =
  | { kind: "text"; text: string }
  | { kind: "thought" }
  | { kind: "tool"; title: string | null };

export function toPromptUpdate(update: unknown): PromptUpdate | null {
  const u = update as
    | {
        sessionUpdate?: string;
        title?: unknown;
        content?: { type?: string; text?: string };
      }
    | undefined;
  switch (u?.sessionUpdate) {
    case "agent_message_chunk":
      return u.content?.type === "text" && typeof u.content.text === "string"
        ? { kind: "text", text: u.content.text }
        : null;
    case "agent_thought_chunk":
      return { kind: "thought" };
    case "tool_call":
      return {
        kind: "tool",
        title: typeof u.title === "string" ? u.title : null,
      };
    case "tool_call_update":
      return typeof u.title === "string"
        ? { kind: "tool", title: u.title }
        : null;
    default:
      return null;
  }
}

export type SendPromptOpts = (
  { resumeSessionId: string } | { platformMeta?: PlatformSessionMeta }
) & {
  onImagesDropped?: () => Promise<void> | void;
  onUpdate?: (update: PromptUpdate) => void;
  onSession?: (sessionId: string, promptId?: string) => void;
  signal?: AbortSignal;
  surface?: string;
};

export type TriggerSessionOpts = {
  prompt: string;
  mcpServers?: unknown[];
} & SessionAttach;

export type AcpTurnStatus = "pending" | "ended" | "interrupted" | "unknown";

export interface AcpClient {
  listSessions(): Promise<AcpSessionInfo[]>;
  sendPrompt(
    prompt: string | ContentBlock[],
    opts: SendPromptOpts,
  ): Promise<string>;
  steer(
    sessionId: string,
    prompt: string | ContentBlock[],
    opts: SteerOpts,
  ): Promise<SteerOutcome>;
  triggerSession(opts: TriggerSessionOpts): Promise<TriggerSessionResult>;
  turnStatus(sessionId: string): Promise<AcpTurnStatus>;
}

function isRefusal(kind: AcpPermissionOption["kind"]): boolean {
  return match(kind)
    .with("reject_once", "reject_always", () => true)
    .with("allow_once", "allow_always", undefined, () => false)
    .exhaustive();
}

function rejectOptionId(
  options: readonly AcpPermissionOption[],
): string | null {
  const preferred = options.find((option) => option.kind === "reject_once");
  const refusal = preferred ?? options.find((option) => isRefusal(option.kind));
  return refusal?.optionId ?? null;
}

function allowOnceOptionId(
  options: readonly AcpPermissionOption[],
): string | null {
  const once = options.find((option) => option.kind === "allow_once");
  return once?.optionId ?? null;
}

function permissionToolName(toolCall: unknown): string | null {
  if (!toolCall || typeof toolCall !== "object") return null;
  const { name } = toolCall as { name?: unknown };
  return typeof name === "string" && name !== "" ? name : null;
}

function permissionToolLabel(toolCall: unknown): string | null {
  if (!toolCall || typeof toolCall !== "object") return null;
  const { title } = toolCall as { title?: unknown };
  const named = permissionToolName(toolCall);
  if (named) return named;
  return typeof title === "string" && title !== "" ? title : null;
}

async function withAcpConnection<T>(
  url: string,
  agentId: string,
  clientName: string,
  handlers: { sessionUpdate?: (params: SessionNotification) => Promise<void> },
  watch: ConnectionWatch,
  fn: (connection: ClientConnection, init: InitializeResponse) => Promise<T>,
): Promise<T> {
  const { stream, ws } = await wsStream(url, agentId);

  const ac = new AbortController();
  let abortError: Error = new AcpTurnAbandonedError(
    "connection-lost",
    "ACP connection aborted",
  );
  const abortWith = (err: Error) => {
    abortError = err;
    ac.abort();
  };

  let missedPongs = 0;
  ws.on("pong", () => {
    missedPongs = 0;
  });
  const heartbeat = setInterval(() => {
    if (missedPongs >= MAX_MISSED_PONGS) {
      abortWith(
        new AcpTurnAbandonedError(
          "connection-lost",
          "ACP connection lost (agent unreachable)",
        ),
      );
      return;
    }
    missedPongs += 1;
    try {
      ws.ping();
    } catch (err) {
      getLogger().debug({ err, clientName }, "acp heartbeat ping failed");
    }
  }, PING_INTERVAL_MS);

  let lastFrameAt = Date.now();
  ws.on("message", () => {
    lastFrameAt = Date.now();
  });

  const connection = connectClient(stream, {
    async requestPermission(params) {
      const toolName = permissionToolLabel(params.toolCall);
      const sessionId = params.sessionId ?? null;
      const allowId = isPlatformMcpTool(permissionToolName(params.toolCall))
        ? allowOnceOptionId(params.options ?? [])
        : null;
      if (allowId) {
        securityLog("info", "approval.platform_tool_allow", {
          category: "approval",
          actor: null,
          actorKind: "agent",
          agentId,
          decision: "allow",
          reason: "platform-mcp-surface",
          detail: { toolName, sessionId },
        });
        return {
          outcome: { outcome: "selected" as const, optionId: allowId },
        };
      }
      const optionId = rejectOptionId(params.options ?? []);
      securityLog("warn", "approval.unattended_deny", {
        category: "approval",
        actor: null,
        actorKind: "agent",
        agentId,
        decision: "deny",
        reason: "unattended-channel-turn",
        detail: { toolName, sessionId },
      });
      return optionId
        ? { outcome: { outcome: "selected" as const, optionId } }
        : { outcome: { outcome: "cancelled" as const } };
    },
    sessionUpdate: handlers.sessionUpdate,
  });

  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let probeTimer: ReturnType<typeof setInterval> | undefined;

  if (watch.kind === "deadline") {
    deadlineTimer = setTimeout(() => {
      abortWith(
        new Error(
          `ACP call exceeded its ${Math.round(watch.ms / 1000)}s deadline`,
        ),
      );
    }, watch.ms);
  } else {
    let probing = false;
    probeTimer = setInterval(() => {
      if (probing) return;
      if (Date.now() - lastFrameAt < watch.stallProbeMs) return;
      const sessionId = watch.sessionId();
      if (sessionId === null) return;
      probing = true;
      void probeTurnStatus(connection, sessionId)
        .then((verdict) => {
          if (verdict === "pending") {
            lastFrameAt = Date.now();
          } else if (verdict !== "unknown") {
            abortWith(
              new AcpTurnAbandonedError(
                "stalled",
                "ACP turn went silent and the agent reports it is no longer running",
              ),
            );
          }
        })
        .finally(() => {
          probing = false;
        });
    }, watch.stallProbeMs);
  }

  const cleanup = () => {
    clearInterval(heartbeat);
    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
    if (probeTimer !== undefined) clearInterval(probeTimer);
    if (
      ws.readyState === WebSocket.OPEN ||
      ws.readyState === WebSocket.CONNECTING
    )
      ws.close();
  };

  try {
    const init = await connection.agent.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      clientInfo: { name: clientName, version: "1.0.0" },
    });
    return await Promise.race([
      fn(connection, init),
      new Promise<never>((_, reject) => {
        if (ac.signal.aborted) {
          reject(abortError);
          return;
        }
        ac.signal.addEventListener("abort", () => reject(abortError), {
          once: true,
        });
      }),
    ]);
  } finally {
    cleanup();
  }
}

export type AcpClientFactory = (instanceName: string) => AcpClient;

/** UNIT_BOUNDARY_DESCRIPTION: a pair as `_meta.platform` fields; a session created with them alone runs on them as its own, and follows no default. */
export function pairFields(pair: SessionPair | null | undefined) {
  if (!pair) return {};
  return {
    harness: pair.harness,
    ...(pair.provider !== null && { provider: pair.provider }),
    ...(pair.model !== null && { model: pair.model }),
    ...(pair.settings && { settings: pair.settings }),
  };
}

function pairMeta(pair: SessionPair | undefined): Record<string, unknown> {
  return pair ? { follows: "channel", ...pairFields(pair) } : {};
}

async function resolvePair(
  firePair:
    ((agentId: string) => Promise<SessionPair | null | undefined>) | undefined,
  runBoundary: RunBoundary | undefined,
  agentId: string,
): Promise<SessionPair | undefined> {
  const pair = await firePair?.(agentId);
  if (pair === null)
    throw new Error(
      "no model provider granted to this agent can run its harness",
    );
  if (!pair || !runBoundary) return pair;
  return (await runBoundary.pair(agentId, pair)) ?? undefined;
}

const refusedForNoModel = (err: unknown): boolean =>
  (err as { data?: { platform?: { reason?: unknown } } } | null)?.data?.platform
    ?.reason === NO_MODEL_REASON;

/**
 * UNIT_BOUNDARY_DESCRIPTION: a session from before the Model Router carries
 * no model, and the runtime refuses its turn rather than pick one. It ran on
 * the agent's one provider and its default model, so that saved default is
 * pinned on it and the turn sent once more; an agent with no default throws
 * NoDefaultModelError from firePair. A runtime that never refuses (one older
 * than the refusal) is never pinned, so a session's own model is kept.
 */
export async function promptPinningDefault<T>(
  connection: ClientConnection,
  sessionId: string,
  prompt: () => Promise<T>,
  firePair: (() => Promise<SessionPair | undefined>) | undefined,
): Promise<T> {
  try {
    return await prompt();
  } catch (err) {
    if (!refusedForNoModel(err) || !firePair) throw err;
    const pair = await firePair();
    if (!pair?.model) throw err;
    await connection.agent.request(PIN_MODEL_METHOD, {
      sessionId,
      model: pair.model,
    });
    return prompt();
  }
}

export function createAcpClient(opts: {
  namespace: string;
  instanceName: string;
  stallProbeMs: number;
  firePair?: (agentId: string) => Promise<SessionPair | null | undefined>;
  /* UNIT_BOUNDARY_DESCRIPTION: every pair this client starts a session on, or pins a default onto, is settled here by the one helper, so the native subagent keys a run takes are never left out of the payload (D193B). */
  runBoundary?: RunBoundary;
}): AcpClient {
  const url = `ws://${agentServiceAddress(opts.instanceName, opts.namespace)}/api/acp`;
  const { instanceName: agentId, stallProbeMs } = opts;
  return {
    async listSessions(): Promise<AcpSessionInfo[]> {
      const { stream, ws } = await wsStream(url, agentId);

      const connection = connectClient(stream, {
        async requestPermission() {
          return { outcome: { outcome: "cancelled" as const } };
        },
      });

      try {
        await connection.agent.request("initialize", {
          protocolVersion: 1,
          clientCapabilities: {},
          clientInfo: { name: "platform-sessions", version: "1.0.0" },
        });
        const r = await connection.agent.request("session/list", { cwd: "." });
        return (r.sessions ?? []).map((s: any): AcpSessionInfo => {
          const parsed = platformSessionMetaSchema.safeParse(
            s?._meta?.platform,
          );
          return {
            sessionId: s.sessionId,
            title: s.title ?? null,
            updatedAt: s.updatedAt ?? null,
            platform: parsed.success ? parsed.data : null,
          };
        });
      } finally {
        if (
          ws.readyState === WebSocket.OPEN ||
          ws.readyState === WebSocket.CONNECTING
        ) {
          ws.close();
        }
      }
    },

    async sendPrompt(
      prompt: string | ContentBlock[],
      sendOpts: SendPromptOpts,
    ): Promise<string> {
      const responseChunks: string[] = [];
      let lastMessage = { id: undefined as unknown, text: "" };
      let live = false;
      let watchSessionId: string | null = null;

      await withAcpConnection(
        url,
        agentId,
        "platform-acp",
        {
          async sessionUpdate(params: any) {
            if (
              params.update?.sessionUpdate === "agent_message_chunk" &&
              params.update.content?.type === "text"
            ) {
              responseChunks.push(params.update.content.text);
              const id = params.update.messageId;
              lastMessage =
                id !== undefined && id === lastMessage.id
                  ? { id, text: lastMessage.text + params.update.content.text }
                  : { id, text: params.update.content.text };
            }
            if (live && sendOpts.onUpdate) {
              const update = toPromptUpdate(params.update);
              if (update) {
                try {
                  sendOpts.onUpdate(update);
                } catch (err) {
                  getLogger().debug(
                    { err },
                    "acp onUpdate callback failed; ignoring",
                  );
                }
              }
            }
          },
        },
        {
          kind: "turn",
          stallProbeMs,
          sessionId: () => watchSessionId,
        },
        async (connection, init) => {
          let sessionId: string;
          if ("resumeSessionId" in sendOpts) {
            try {
              await connection.agent.request("session/load", {
                sessionId: sendOpts.resumeSessionId,
                cwd: ".",
                mcpServers: [],
              });
            } catch (err) {
              throw new AcpSessionLoadError(
                `failed to load session ${sendOpts.resumeSessionId}`,
                { cause: err },
              );
            }
            responseChunks.length = 0;
            sessionId = sendOpts.resumeSessionId;
            watchSessionId = sessionId;
          } else {
            const caller = sendOpts.platformMeta;
            const platform = {
              ...(caller?.harness === undefined &&
                pairMeta(
                  await resolvePair(opts.firePair, opts.runBoundary, agentId),
                )),
              ...caller,
            };
            const newSession: NewSessionRequest = {
              cwd: ".",
              mcpServers: [],
              ...(Object.keys(platform).length > 0 && {
                _meta: { platform },
              }),
            };
            const s = await connection.agent.request("session/new", newSession);
            sessionId = s.sessionId;
            watchSessionId = sessionId;
          }
          const promptId = randomUUID();
          try {
            sendOpts.onSession?.(sessionId, promptId);
          } catch (err) {
            getLogger().debug(
              { err },
              "acp onSession callback failed; ignoring",
            );
          }

          const blocks: ContentBlock[] =
            typeof prompt === "string"
              ? [{ type: "text", text: prompt }]
              : prompt;
          const supportsImages =
            init.agentCapabilities?.promptCapabilities?.image === true;
          const hasImages = blocks.some((b) => b.type === "image");
          const finalBlocks =
            hasImages && !supportsImages
              ? blocks.filter((b) => b.type !== "image")
              : blocks;
          if (hasImages && !supportsImages) {
            await sendOpts.onImagesDropped?.();
          }

          const { signal } = sendOpts;
          signal?.throwIfAborted();
          live = true;
          lastMessage = { id: undefined, text: "" };
          const send = () =>
            connection.agent.request("session/prompt", {
              sessionId,
              prompt: finalBlocks,
              _meta: {
                platform: {
                  promptId,
                  ...(sendOpts.surface !== undefined && {
                    surface: sendOpts.surface,
                  }),
                },
              },
            });
          const cancel = () => {
            connection.agent
              .notify("session/cancel", { sessionId })
              .catch((err) =>
                getLogger().debug({ err, sessionId }, "acp cancel failed"),
              );
          };
          signal?.addEventListener("abort", cancel, { once: true });
          let ended: { stopReason?: string };
          try {
            ended = await ("resumeSessionId" in sendOpts
              ? promptPinningDefault(connection, sessionId, send, () =>
                  resolvePair(opts.firePair, opts.runBoundary, agentId),
                )
              : send());
          } catch (err) {
            const failed = modelCallFailure(err, lastMessage.text);
            if (failed === null) throw err;
            throw new AcpModelCallFailedError(
              sessionId,
              failed.failure,
              failed.providerText,
              { cause: err },
            );
          } finally {
            signal?.removeEventListener("abort", cancel);
          }
          if (ended.stopReason === MODEL_REFUSAL_STOP_REASON)
            throw new AcpModelRefusedError(sessionId);
        },
      );

      return responseChunks.join("");
    },

    async steer(
      sessionId: string,
      prompt: string | ContentBlock[],
      steerOpts: SteerOpts,
    ): Promise<SteerOutcome> {
      const blocks: ContentBlock[] =
        typeof prompt === "string" ? [{ type: "text", text: prompt }] : prompt;
      const { promptId, targetPromptId, signal } = steerOpts;
      try {
        signal?.throwIfAborted();
        return await withAcpConnection(
          url,
          agentId,
          "platform-steer",
          {},
          { kind: "turn", stallProbeMs, sessionId: () => sessionId },
          async (connection, init) => {
            if (!servesSteeringSupported(init)) return "unsupported";
            signal?.throwIfAborted();
            const answer = connection.agent.request(STEER_METHOD, {
              sessionId,
              prompt: blocks,
              _meta: {
                steering: { idleBehavior: "promptRequired" },
                platform: { promptId, targetPromptId },
              },
            });
            const aborted = new Promise<never>((_, reject) => {
              signal?.addEventListener(
                "abort",
                () => reject(new Error("steer aborted")),
                { once: true },
              );
            });
            let raw: unknown;
            try {
              raw = await Promise.race([answer, aborted]);
            } catch (err) {
              if ((err as { code?: unknown } | null)?.code === -32601)
                return "unsupported";
              throw err;
            }
            const parsed = steerResponseSchema.safeParse(raw);
            const outcome = parsed.success ? parsed.data.outcome : undefined;
            if (outcome === "injected") return "injected";
            if (outcome === "promptRequired") return "no-running-turn";
            return "failed";
          },
        );
      } catch (err) {
        getLogger().debug({ err, sessionId }, "acp steer failed");
        return "failed";
      }
    },

    async turnStatus(sessionId: string): Promise<AcpTurnStatus> {
      return withAcpConnection(
        url,
        agentId,
        "platform-turn-status",
        {},
        { kind: "deadline", ms: TURN_STATUS_DEADLINE_MS },
        (connection) => probeTurnStatus(connection, sessionId),
      );
    },

    async triggerSession(
      triggerOpts: TriggerSessionOpts,
    ): Promise<TriggerSessionResult> {
      let watchSessionId: string | null = null;
      return withAcpConnection(
        url,
        agentId,
        "platform-trigger",
        {},
        {
          kind: "turn",
          stallProbeMs,
          sessionId: () => watchSessionId,
        },
        async (connection) => {
          let sessionId: string;
          const mcpServers = (triggerOpts.mcpServers ?? []) as McpServer[];

          if ("resumeSessionId" in triggerOpts) {
            try {
              await connection.agent.request("session/resume", {
                sessionId: triggerOpts.resumeSessionId,
                cwd: ".",
                mcpServers,
              });
            } catch (err) {
              throw new AcpSessionLoadError(
                `failed to resume session ${triggerOpts.resumeSessionId}`,
                { cause: err },
              );
            }
            sessionId = triggerOpts.resumeSessionId;
            watchSessionId = sessionId;
          } else {
            const pair = await resolvePair(
              opts.firePair,
              opts.runBoundary,
              agentId,
            );
            const s = await connection.agent.request("session/new", {
              cwd: ".",
              mcpServers,
              ...(pair && { _meta: { platform: pairMeta(pair) } }),
            });
            sessionId = s.sessionId;
            watchSessionId = sessionId;
            await triggerOpts.onSessionCreated(sessionId);
          }

          const send = () =>
            connection.agent.request("session/prompt", {
              sessionId,
              prompt: [{ type: "text", text: triggerOpts.prompt }],
            });
          const r = await ("resumeSessionId" in triggerOpts
            ? promptPinningDefault(connection, sessionId, send, () =>
                resolvePair(opts.firePair, opts.runBoundary, agentId),
              )
            : send());

          return { sessionId, stopReason: r.stopReason };
        },
      );
    },
  };
}
