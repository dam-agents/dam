import { performance } from "node:perf_hooks";
import { buildPlatformTurnEndedNotification } from "api-server-api";

import { frameDirectTurn, isDirectSurface } from "../../domain/direct-turn.js";
import {
  isRequest,
  isResponse,
  parseFrame,
  type JsonRpcId,
} from "../../domain/frames.js";
import { rewriteAuthError, rewriteCwd } from "../../domain/mappers.js";
import type { AgentProcess } from "../../infrastructure/agent-process.js";
import type { ClientChannel } from "../../infrastructure/client-channel.js";
import {
  platformSessionMetaSchema,
  type PlatformSessionMeta,
  type SessionMetaEntry,
  type SessionMetadataStore,
} from "../../infrastructure/session-metadata-store.js";
import type {
  BackgroundWorkRegistry,
  HeldSession,
} from "../background-work-registry.js";
import {
  createHarnessLease,
  type HarnessTeardownReason,
} from "./harness-lease.js";
import { createPromptScheduler } from "./prompt-scheduler.js";
import { createSessionTranscript } from "./session-transcript.js";

const DEFAULT_ORPHAN_TTL_MS = 10 * 60 * 1000;

const DEFAULT_ENV_FORCE_RECYCLE_MS = 60 * 1000;

const DEFAULT_WARM_START_TIMEOUT_MS = 15 * 1000;

const DEFAULT_LOG_BYTES_CAP = 2 * 1024 * 1024;

const DEFAULT_BACKGROUND_WORK_RECHECK_MS = 15 * 1000;

export interface AcpRuntimeStatus {
  idle: boolean;
  backgroundWork: HeldSession[];
}

export interface AcpRuntime {
  attach(channel: ClientChannel, opts?: { viewer?: boolean }): void;
  status(): AcpRuntimeStatus;
  resetSession(sessionId: string): void;
  refreshEnv(opts: { force: boolean }): void;
  shutdown(): void;
}

export interface AcpRuntimeDeps {
  spawnAgent: () => AgentProcess;
  workingDir: string;
  log?: (msg: string) => void;
  orphanTtlMs?: number;
  envForceRecycleMs?: number;
  idleReapDelayMs?: number;
  envReadyAtBoot?: boolean;
  warmStartTimeoutMs?: number;
  logBytesCap?: number;
  sessionMetadata?: SessionMetadataStore;
  backgroundWork?: BackgroundWorkRegistry;
  backgroundWorkRecheckMs?: number;
  isTerminalSessionActive?: (sessionId: string) => boolean;
}

interface OutboundMapping {
  channel: ClientChannel | null;
  originalId: JsonRpcId | null;
  method: string;
  promptSessionId: string | null;
  attachSessionId: string | null;
  platformMeta: PlatformSessionMeta | null;
}

interface PendingAgentRequest {
  sessionId: string | null;
  frame: string;
}

type BootstrapWaiter =
  | { kind: "load"; channel: ClientChannel; originalId: JsonRpcId }
  | { kind: "resume"; channel: ClientChannel; originalId: JsonRpcId };

interface BootstrapState {
  initiatorChannel: ClientChannel | null;
  initiatorOutboundId: number;
  waiters: BootstrapWaiter[];
}

export function createAcpRuntime(deps: AcpRuntimeDeps): AcpRuntime {
  const orphanTtlMs = deps.orphanTtlMs ?? DEFAULT_ORPHAN_TTL_MS;
  const logBytesCap = deps.logBytesCap ?? DEFAULT_LOG_BYTES_CAP;
  const envForceRecycleMs =
    deps.envForceRecycleMs ?? DEFAULT_ENV_FORCE_RECYCLE_MS;
  const idleReapDelayMs = deps.idleReapDelayMs ?? 0;
  const backgroundWorkRecheckMs =
    deps.backgroundWorkRecheckMs ?? DEFAULT_BACKGROUND_WORK_RECHECK_MS;
  const warmStartTimeoutMs =
    deps.warmStartTimeoutMs ?? DEFAULT_WARM_START_TIMEOUT_MS;
  let sessionCloseSupported = true;
  const engagedSessions = new Map<ClientChannel, Set<string>>();
  const nonViewerChannels = new Set<ClientChannel>();
  const pendingFromAgent = new Map<JsonRpcId, PendingAgentRequest>();
  const outboundIdToClient = new Map<number, OutboundMapping>();

  const promptScheduler = createPromptScheduler({
    sendToAgent: (frame) => lease.send(frame),
  });

  const transcript = createSessionTranscript({
    logBytesCap,
    engagedChannelsFor(sessionId) {
      const channels: ClientChannel[] = [];
      for (const [channel, sessions] of engagedSessions) {
        if (sessions.has(sessionId)) channels.push(channel);
      }
      return channels;
    },
  });

  const bootstrapBySession = new Map<string, BootstrapState>();

  let nextOutboundId = 1;
  const orphanTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const idleReapTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const teardownCloseByReason: Record<
    HarnessTeardownReason,
    { code: number; message: string }
  > = {
    "agent-exited": { code: 1011, message: "agent exited" },
    "env-recycle": { code: 1011, message: "agent recycled for env change" },
    shutdown: { code: 1000, message: "shutdown" },
  };

  function teardownRuntime(reason: HarnessTeardownReason): void {
    const close = teardownCloseByReason[reason];
    for (const channel of engagedSessions.keys()) {
      channel.close(close.code, close.message);
    }
    engagedSessions.clear();
    transcript.clear();
    bootstrapBySession.clear();
    for (const t of orphanTimers.values()) clearTimeout(t);
    orphanTimers.clear();
    for (const t of idleReapTimers.values()) clearTimeout(t);
    idleReapTimers.clear();
    pendingFromAgent.clear();
    promptScheduler.clear();
    deps.backgroundWork?.clear();
  }

  function describeBusy(): string {
    return (
      `${promptScheduler.activeTurnCount()} turn(s), ` +
      `${pendingFromAgent.size} pending request(s), ` +
      `${deps.backgroundWork?.held().length ?? 0} background hold(s)`
    );
  }

  const lease = createHarnessLease({
    spawnAgent: deps.spawnAgent,
    onFrame(line) {
      const start = performance.now();
      handleAgentLine(line);
      const ms = performance.now() - start;
      if (ms >= 250) {
        const method =
          (parseFrame(line) as { method?: string } | null)?.method ??
          "response";
        deps.log?.(
          `slow frame ${Math.round(ms)}ms (${line.length}B, ${method})`,
        );
      }
    },
    onTeardown: teardownRuntime,
    busy: runtimeBusy,
    describeBusy,
    envReadyAtBoot: deps.envReadyAtBoot ?? true,
    warmStartTimeoutMs,
    envForceRecycleMs,
    log(msg) {
      deps.log?.(msg);
    },
  });

  function engage(channel: ClientChannel, sessionId: string): void {
    const sessions = engagedSessions.get(channel);
    if (!sessions) return;
    if (sessions.has(sessionId)) return;
    sessions.add(sessionId);
    if (!nonViewerChannels.has(channel))
      deps.sessionMetadata?.recordSeen(sessionId);

    for (const req of pendingFromAgent.values()) {
      if (req.sessionId === sessionId && channel.isOpen()) {
        channel.send(rewriteAuthError(req.frame));
      }
    }

    updateOrphanTimerForSession(sessionId);
  }

  function hasEngagedChannel(sessionId: string): boolean {
    for (const [channel, sessions] of engagedSessions) {
      if (sessions.has(sessionId) && channel.isOpen()) return true;
    }
    return false;
  }

  function hasEngagedViewer(sessionId: string): boolean {
    for (const [channel, sessions] of engagedSessions) {
      if (
        sessions.has(sessionId) &&
        channel.isOpen() &&
        !nonViewerChannels.has(channel)
      )
        return true;
    }
    return false;
  }

  function appendUserPromptToLog(
    sessionId: string,
    prompt: unknown,
    originator: ClientChannel,
    queued: boolean,
  ): void {
    if (!Array.isArray(prompt)) return;
    for (const block of prompt) {
      if (!block || typeof block !== "object") continue;
      const update: Record<string, unknown> = {
        sessionUpdate: "user_message_chunk",
        content: block,
      };
      if (queued) update._meta = { queued: true };
      const line = JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: { sessionId, update },
      });
      transcript.appendEcho(sessionId, line, originator);
    }
  }

  function broadcastToAll(line: string): void {
    const out = rewriteAuthError(line);
    for (const channel of engagedSessions.keys()) {
      if (channel.isOpen()) channel.send(out);
    }
  }

  function sendToChannel(c: ClientChannel, line: string): void {
    if (c.isOpen()) c.send(line);
  }

  function updateOrphanTimerForSession(sessionId: string): void {
    const engaged = hasEngagedChannel(sessionId);
    let hasPending = false;
    for (const req of pendingFromAgent.values()) {
      if (req.sessionId === sessionId) {
        hasPending = true;
        break;
      }
    }
    const existing = orphanTimers.get(sessionId);
    const shouldRun = hasPending && !engaged;
    if (shouldRun && !existing) {
      orphanTimers.set(
        sessionId,
        setTimeout(() => expireSession(sessionId), orphanTtlMs),
      );
    } else if (!shouldRun && existing) {
      clearTimeout(existing);
      orphanTimers.delete(sessionId);
    }
  }

  function expireSession(sessionId: string): void {
    orphanTimers.delete(sessionId);
    const toExpire: JsonRpcId[] = [];
    for (const [id, req] of pendingFromAgent) {
      if (req.sessionId === sessionId) toExpire.push(id);
    }
    for (const id of toExpire) {
      lease.send({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32000,
          message: "Permission request expired: no client connected",
        },
      });
      pendingFromAgent.delete(id);
    }
    if (toExpire.length > 0) lease.maybeRecycle();
  }

  function runtimeBusy(): boolean {
    if (promptScheduler.anyWork() || pendingFromAgent.size > 0) return true;
    return (deps.backgroundWork?.held().length ?? 0) > 0;
  }

  deps.backgroundWork?.onRelease(() => lease.maybeRecycle());

  function detach(channel: ClientChannel): void {
    const sessions = engagedSessions.get(channel);
    engagedSessions.delete(channel);
    nonViewerChannels.delete(channel);
    transcript.dropChannel(channel);
    promptScheduler.dropChannel(channel);

    for (const [sid, state] of bootstrapBySession) {
      if (state.initiatorChannel === channel) {
        bootstrapBySession.delete(sid);
        continue;
      }
      const keptWaiters = state.waiters.filter((w) => w.channel !== channel);
      if (keptWaiters.length !== state.waiters.length) {
        state.waiters = keptWaiters;
      }
    }

    for (const [outId, m] of outboundIdToClient) {
      if (m.channel === channel && m.promptSessionId === null) {
        outboundIdToClient.delete(outId);
      }
    }

    if (sessions) {
      for (const sid of sessions) {
        updateOrphanTimerForSession(sid);
        maybeCloseIdleSession(sid);
      }
    }
  }

  function tearDownSession(sessionId: string): void {
    if (sessionCloseSupported) {
      lease.send({
        jsonrpc: "2.0",
        id: nextOutboundId++,
        method: "session/close",
        params: { sessionId },
      });
    }
    transcript.forget(sessionId);
    promptScheduler.forget(sessionId);
    deps.backgroundWork?.forget(sessionId);
    lease.maybeRecycle();
    const reap = idleReapTimers.get(sessionId);
    if (reap) {
      clearTimeout(reap);
      idleReapTimers.delete(sessionId);
    }
  }

  function reapIdleSessionNow(sessionId: string): void {
    idleReapTimers.delete(sessionId);
    if (!sessionCloseSupported) return;
    if (hasEngagedChannel(sessionId)) return;
    if (promptScheduler.hasWork(sessionId)) return;
    if (bootstrapBySession.has(sessionId)) return;
    for (const req of pendingFromAgent.values()) {
      if (req.sessionId === sessionId) return;
    }
    if (deps.backgroundWork?.hasWork(sessionId)) {
      idleReapTimers.set(
        sessionId,
        setTimeout(
          () => reapIdleSessionNow(sessionId),
          backgroundWorkRecheckMs,
        ),
      );
      return;
    }

    tearDownSession(sessionId);
    deps.log?.(`closing idle session ${sessionId}`);
  }

  function maybeCloseIdleSession(sessionId: string): void {
    if (idleReapDelayMs <= 0) {
      reapIdleSessionNow(sessionId);
      return;
    }
    const existing = idleReapTimers.get(sessionId);
    if (existing) clearTimeout(existing);
    idleReapTimers.set(
      sessionId,
      setTimeout(() => reapIdleSessionNow(sessionId), idleReapDelayMs),
    );
  }

  function serveLoadFromLog(
    channel: ClientChannel,
    originalId: JsonRpcId,
    sessionId: string,
  ): void {
    const metadata = transcript.metadataOf(sessionId);
    if (!metadata.cached) {
      throw new Error(
        `serveLoadFromLog called for ${sessionId} without cached metadata`,
      );
    }
    transcript.catchUp(channel, sessionId);
    engage(channel, sessionId);
    const response = JSON.stringify({
      jsonrpc: "2.0",
      id: originalId,
      result: metadata.value,
    });
    sendToChannel(channel, rewriteAuthError(response));
  }

  function serveResumeFromLog(
    channel: ClientChannel,
    originalId: JsonRpcId,
    sessionId: string,
  ): void {
    const metadata = transcript.metadataOf(sessionId);
    if (!metadata.cached) {
      throw new Error(
        `serveResumeFromLog called for ${sessionId} without cached metadata`,
      );
    }
    engage(channel, sessionId);
    transcript.advanceToTail(channel, sessionId);
    const response = JSON.stringify({
      jsonrpc: "2.0",
      id: originalId,
      result: metadata.value,
    });
    sendToChannel(channel, rewriteAuthError(response));
  }

  function handleAgentLine(line: string): void {
    const frame = parseFrame(line);

    if (frame && isRequest(frame)) {
      const sessionId = extractParamsSessionId(frame);
      pendingFromAgent.set(frame.id, { sessionId, frame: line });
      if (sessionId) {
        const out = rewriteAuthError(line);
        for (const [channel, sessions] of engagedSessions) {
          if (sessions.has(sessionId) && channel.isOpen()) channel.send(out);
        }
        updateOrphanTimerForSession(sessionId);
      } else {
        broadcastToAll(line);
      }
      return;
    }

    if (frame && isResponse(frame)) {
      const outboundId = frame.id as number;
      const mapping = outboundIdToClient.get(outboundId);
      if (mapping) {
        outboundIdToClient.delete(outboundId);

        if (mapping.method === "initialize") {
          sessionCloseSupported = extractSessionCloseSupported(frame);
        }

        const sidFromResult = extractResultSessionId(frame);
        const sidForChannel = sidFromResult ?? mapping.attachSessionId;
        if (sidForChannel) {
          if (mapping.channel) engage(mapping.channel, sidForChannel);
          const cacheable =
            mapping.method === "session/new" ||
            mapping.method === "session/fork" ||
            mapping.method === "session/load";
          const result = (frame as { result?: unknown }).result;
          if (cacheable && result !== undefined) {
            transcript.cacheMetadata(sidForChannel, result);
          }
          if (
            mapping.method === "session/new" &&
            sidFromResult &&
            deps.sessionMetadata
          ) {
            deps.sessionMetadata.set(sidFromResult, mapping.platformMeta ?? {});
          }
        }

        if (mapping.method === "session/load" && mapping.attachSessionId) {
          const sid = mapping.attachSessionId;
          const boot = bootstrapBySession.get(sid);
          if (boot) {
            bootstrapBySession.delete(sid);
            const loadFailed = !transcript.metadataOf(sid).cached;
            for (const waiter of boot.waiters) {
              if (!waiter.channel.isOpen()) continue;
              if (loadFailed) {
                const out = JSON.stringify({
                  ...(frame as object),
                  id: waiter.originalId,
                });
                waiter.channel.send(rewriteAuthError(out));
                continue;
              }
              if (waiter.kind === "load") {
                serveLoadFromLog(waiter.channel, waiter.originalId, sid);
              } else {
                serveResumeFromLog(waiter.channel, waiter.originalId, sid);
              }
            }
          }
        }

        if (mapping.channel && mapping.originalId !== null) {
          const responseFrame =
            mapping.method === "session/list" && deps.sessionMetadata
              ? injectPlatformMetaIntoList(
                  frame,
                  deps.sessionMetadata,
                  (sid) =>
                    promptScheduler.hasTurnInFlight(sid) ||
                    (deps.isTerminalSessionActive?.(sid) ?? false),
                )
              : (frame as object);
          const out = JSON.stringify({
            ...responseFrame,
            id: mapping.originalId,
          });
          if (mapping.channel.isOpen())
            mapping.channel.send(rewriteAuthError(out));
        }

        if (mapping.promptSessionId !== null) {
          const sid = mapping.promptSessionId;
          const { turnEnded } = promptScheduler.onPromptResponse(
            sid,
            outboundId,
          );
          deps.sessionMetadata?.recordActivity(sid);
          if (hasEngagedViewer(sid)) deps.sessionMetadata?.recordSeen(sid);
          transcript.append(
            sid,
            JSON.stringify(
              buildPlatformTurnEndedNotification({ sessionId: sid }),
            ),
          );
          maybeCloseIdleSession(sid);
          if (turnEnded) lease.maybeRecycle();
        }
      }
      return;
    }

    const sessionId = extractParamsSessionId(frame);
    if (sessionId) {
      const boot = bootstrapBySession.get(sessionId);
      if (boot) {
        transcript.appendReplay(sessionId, line, boot.initiatorChannel);
      } else {
        transcript.append(sessionId, line);
      }
    } else {
      broadcastToAll(line);
    }
  }

  function handleClientMessage(channel: ClientChannel, data: string): void {
    const frame = parseFrame(data);
    if (!frame) {
      deps.log?.(`dropping non-JSON client message: ${data}`);
      return;
    }

    if (isResponse(frame)) {
      const pending = pendingFromAgent.get(frame.id);
      if (!pending) return;
      pendingFromAgent.delete(frame.id);
      if (pending.sessionId) updateOrphanTimerForSession(pending.sessionId);
      lease.send(frame);
      return;
    }

    if (isRequest(frame)) {
      const method =
        typeof (frame as { method?: unknown }).method === "string"
          ? (frame as { method: string }).method
          : "";
      const paramsSid = extractParamsSessionId(frame);

      if (method === "platform/deleteSession" && paramsSid) {
        deps.sessionMetadata?.tombstone(paramsSid);
        sendToChannel(
          channel,
          JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: {} }),
        );
        return;
      }

      if (method === "session/resume" && paramsSid) {
        const incomingMeta = extractPlatformMeta(frame);
        if (incomingMeta && deps.sessionMetadata) {
          const current = deps.sessionMetadata.get(paramsSid)?.meta ?? {};
          deps.sessionMetadata.set(paramsSid, { ...current, ...incomingMeta });
        }
        engage(channel, paramsSid);
        if (transcript.metadataOf(paramsSid).cached) {
          serveResumeFromLog(channel, frame.id, paramsSid);
          return;
        }
        const boot = bootstrapBySession.get(paramsSid);
        if (boot) {
          boot.waiters.push({ kind: "resume", channel, originalId: frame.id });
          return;
        }
        const outboundId = nextOutboundId++;
        bootstrapBySession.set(paramsSid, {
          initiatorChannel: null,
          initiatorOutboundId: outboundId,
          waiters: [{ kind: "resume", channel, originalId: frame.id }],
        });
        outboundIdToClient.set(outboundId, {
          channel: null,
          originalId: null,
          method: "session/load",
          promptSessionId: null,
          attachSessionId: paramsSid,
          platformMeta: null,
        });
        const loadFrame = {
          jsonrpc: "2.0",
          id: outboundId,
          method: "session/load",
          params: { sessionId: paramsSid, cwd: ".", mcpServers: [] },
        };
        lease.send(rewriteCwd(loadFrame, deps.workingDir));
        return;
      }

      if (method === "session/load" && paramsSid) {
        if (transcript.metadataOf(paramsSid).cached) {
          serveLoadFromLog(channel, frame.id, paramsSid);
          return;
        }
        const boot = bootstrapBySession.get(paramsSid);
        if (boot) {
          boot.waiters.push({ kind: "load", channel, originalId: frame.id });
          return;
        }
      }

      const outboundId = nextOutboundId++;

      if (paramsSid) engage(channel, paramsSid);

      const promptSessionId = method === "session/prompt" ? paramsSid : null;
      const attachSessionId = method === "session/load" ? paramsSid : null;

      const platformMeta =
        method === "session/new" ? extractPlatformMeta(frame) : null;
      const promptId =
        method === "session/prompt" ? extractPromptId(frame) : null;
      const forwardFrame =
        platformMeta !== null || method === "session/prompt"
          ? stripPlatformMeta(frame)
          : frame;

      const framedFrame =
        promptSessionId !== null &&
        isDirectSurface(extractPromptSurface(frame)) &&
        deps.sessionMetadata?.get(promptSessionId)?.meta.threadTs !== undefined
          ? frameDirectTurn(forwardFrame)
          : forwardFrame;

      const rewritten = rewriteCwd(
        { ...framedFrame, id: outboundId },
        deps.workingDir,
      );
      outboundIdToClient.set(outboundId, {
        channel,
        originalId: frame.id,
        method,
        promptSessionId,
        attachSessionId,
        platformMeta,
      });

      if (method === "session/load" && attachSessionId) {
        bootstrapBySession.set(attachSessionId, {
          initiatorChannel: channel,
          initiatorOutboundId: outboundId,
          waiters: [],
        });
      }

      if (promptSessionId !== null) {
        deps.sessionMetadata?.recordActivity(promptSessionId);
        if (hasEngagedViewer(promptSessionId))
          deps.sessionMetadata?.recordSeen(promptSessionId);
        const promptBlocks = (frame as { params?: { prompt?: unknown } }).params
          ?.prompt;
        const willQueue = promptScheduler.hasTurnInFlight(promptSessionId);
        appendUserPromptToLog(
          promptSessionId,
          promptBlocks,
          channel,
          willQueue,
        );

        const fate = promptScheduler.submit({
          sessionId: promptSessionId,
          channel,
          outboundId,
          originalId: frame.id,
          frame: rewritten,
          promptId,
        });
        if (fate === "refused") outboundIdToClient.delete(outboundId);
        return;
      }

      lease.send(rewritten);
      return;
    }

    const notifSid = extractParamsSessionId(frame);
    if (notifSid) engage(channel, notifSid);
    lease.send(rewriteCwd(frame, deps.workingDir));
  }

  return {
    attach(channel, opts) {
      engagedSessions.set(channel, new Set());
      if (opts?.viewer === false) nonViewerChannels.add(channel);
      const buffered: string[] = [];
      let live = false;
      const release = (): void => {
        if (live) return;
        if (!lease.ensure()) {
          channel.close(1011, "agent process is not running");
          return;
        }
        live = true;
        for (const data of buffered) handleClientMessage(channel, data);
        buffered.length = 0;
      };
      channel.onMessage((data) => {
        if (live) handleClientMessage(channel, data);
        else buffered.push(data);
      });
      let cancelReady: () => void = () => {};
      channel.onClose(() => {
        cancelReady();
        detach(channel);
      });
      cancelReady = lease.whenReady(release);
    },

    status() {
      return {
        idle: !runtimeBusy(),
        backgroundWork: deps.backgroundWork?.held() ?? [],
      };
    },

    resetSession(sessionId) {
      tearDownSession(sessionId);
      deps.log?.(`reset session ${sessionId}`);
    },

    refreshEnv(opts) {
      lease.refreshEnv(opts);
    },

    shutdown() {
      lease.shutdown();
    },
  };
}

function isNonNullObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function extractPlatformMeta(frame: unknown): PlatformSessionMeta | null {
  if (!isNonNullObject(frame)) return null;
  const params = frame.params;
  if (!isNonNullObject(params)) return null;
  const meta = params._meta;
  if (!isNonNullObject(meta) || !("platform" in meta)) return null;
  const parsed = platformSessionMetaSchema.safeParse(meta.platform);
  return parsed.success ? parsed.data : null;
}

function extractPromptId(frame: unknown): string | null {
  if (!isNonNullObject(frame)) return null;
  const params = frame.params;
  if (!isNonNullObject(params)) return null;
  const meta = params._meta;
  if (!isNonNullObject(meta)) return null;
  const platform = meta.platform;
  if (!isNonNullObject(platform)) return null;
  const promptId = platform.promptId;
  return typeof promptId === "string" && promptId.length > 0 ? promptId : null;
}

function extractPromptSurface(frame: unknown): string | null {
  if (!isNonNullObject(frame)) return null;
  const params = frame.params;
  if (!isNonNullObject(params)) return null;
  const meta = params._meta;
  if (!isNonNullObject(meta)) return null;
  const platform = meta.platform;
  if (!isNonNullObject(platform)) return null;
  const surface = platform.surface;
  return typeof surface === "string" && surface.length > 0 ? surface : null;
}

function stripPlatformMeta(frame: unknown): object {
  if (!isNonNullObject(frame)) return frame as object;
  const params = frame.params;
  if (!isNonNullObject(params)) return frame as object;
  const meta = params._meta;
  if (!isNonNullObject(meta)) return frame as object;
  const { platform: _platform, ...restMeta } = meta;
  const nextParams: Record<string, unknown> = { ...params };
  if (Object.keys(restMeta).length > 0) nextParams._meta = restMeta;
  else delete nextParams._meta;
  return { ...frame, params: nextParams };
}

function withPlatformMeta(
  session: Record<string, unknown>,
  entry: SessionMetaEntry,
  running: boolean,
): Record<string, unknown> {
  const existingMeta = isNonNullObject(session._meta) ? session._meta : {};
  return {
    ...session,
    ...(entry.lastActivityAt ? { updatedAt: entry.lastActivityAt } : {}),
    _meta: {
      ...existingMeta,
      platform: {
        ...entry.meta,
        createdAt: entry.createdAt,
        running,
        ...(entry.seenAt ? { seenAt: entry.seenAt } : {}),
      },
    },
  };
}

function injectPlatformMetaIntoList(
  frame: unknown,
  store: SessionMetadataStore,
  isRunning: (sessionId: string) => boolean,
): object {
  if (!isNonNullObject(frame)) return frame as object;
  const result = frame.result;
  if (!isNonNullObject(result)) return frame as object;
  const listed = Array.isArray(result.sessions) ? result.sessions : [];
  const enriched = listed
    .filter(
      (s) =>
        !(
          isNonNullObject(s) &&
          typeof s.sessionId === "string" &&
          store.isTombstoned(s.sessionId)
        ),
    )
    .map((s) => {
      if (!isNonNullObject(s) || typeof s.sessionId !== "string") return s;
      const entry = store.get(s.sessionId);
      if (entry) return withPlatformMeta(s, entry, isRunning(s.sessionId));
      if (!isRunning(s.sessionId)) return s;
      const existingMeta = isNonNullObject(s._meta) ? s._meta : {};
      return {
        ...s,
        _meta: {
          ...existingMeta,
          platform: { mode: "terminal", running: true },
        },
      };
    });
  return { ...frame, result: { ...result, sessions: enriched } };
}

function extractSessionCloseSupported(frame: unknown): boolean {
  if (!isNonNullObject(frame)) return false;
  const result = frame.result;
  if (!isNonNullObject(result)) return false;
  const caps = result.agentCapabilities;
  if (!isNonNullObject(caps)) return false;
  const session = caps.sessionCapabilities;
  if (!isNonNullObject(session)) return false;
  return isNonNullObject(session.close);
}

function extractParamsSessionId(frame: unknown): string | null {
  if (!isNonNullObject(frame)) return null;
  const params = frame.params;
  if (!isNonNullObject(params)) return null;
  const sid = params.sessionId;
  return typeof sid === "string" ? sid : null;
}

function extractResultSessionId(frame: unknown): string | null {
  if (!isNonNullObject(frame)) return null;
  const result = frame.result;
  if (!isNonNullObject(result)) return null;
  const sid = result.sessionId;
  return typeof sid === "string" ? sid : null;
}
