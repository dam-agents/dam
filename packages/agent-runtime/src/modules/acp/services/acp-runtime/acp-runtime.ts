import { performance } from "node:perf_hooks";
import type { PodSession } from "agent-runtime-api";
import {
  buildPlatformTurnEndedNotification,
  SessionType,
} from "api-server-api";

import {
  artifactTouchIn,
  type ArtifactTouch,
} from "../../domain/artifact-touch.js";
import { frameDirectTurn, isDirectSurface } from "../../domain/direct-turn.js";
import {
  isRequest,
  isResponse,
  parseFrame,
  type JsonRpcId,
} from "../../domain/frames.js";
import { rewriteAuthError, rewriteCwd } from "../../domain/mappers.js";
import {
  composeSessionList,
  type ListedHarnessSession,
} from "../../domain/session-list.js";
import type { AgentProcess } from "../../infrastructure/agent-process.js";
import type { ClientChannel } from "../../infrastructure/client-channel.js";
import type { HistoryProvider } from "../../infrastructure/history-provider.js";
import {
  platformSessionMetaSchema,
  type PlatformSessionMeta,
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
import { createPendingAgentRequests } from "./pending-agent-requests.js";
import { createPromptScheduler } from "./prompt-scheduler.js";
import { createSessionBootstrap } from "./session-bootstrap.js";
import { createSessionTranscript } from "./session-transcript.js";

const DEFAULT_ORPHAN_TTL_MS = 10 * 60 * 1000;

const DEFAULT_ENV_FORCE_RECYCLE_MS = 60 * 1000;

const DEFAULT_WARM_START_TIMEOUT_MS = 15 * 1000;

const DEFAULT_LOG_BYTES_CAP = 2 * 1024 * 1024;

const DEFAULT_REPLAY_TAIL_EVENTS = 200;

const DEFAULT_HARNESS_LOAD_TIMEOUT_MS = 30 * 1000;

const DEFAULT_BACKGROUND_WORK_RECHECK_MS = 15 * 1000;

export interface AcpRuntimeStatus {
  idle: boolean;
  backgroundWork: HeldSession[];
}

export interface AcpRuntime {
  attach(channel: ClientChannel, opts?: { viewer?: boolean }): void;
  status(): AcpRuntimeStatus;
  isSessionRunning(sessionId: string): boolean;
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
  replayTailEvents?: number;
  harnessLoadTimeoutMs?: number;
  historyProvider?: HistoryProvider;
  sessionMetadata?: SessionMetadataStore;
  backgroundWork?: BackgroundWorkRegistry;
  backgroundWorkRecheckMs?: number;
  isTerminalSessionActive?: (sessionId: string) => boolean;
  onArtifactTouch?: (touch: ArtifactTouch) => void;
}

interface OutboundMapping {
  channel: ClientChannel | null;
  originalId: JsonRpcId | null;
  method: string;
  promptSessionId: string | null;
  attachSessionId: string | null;
  platformMeta: PlatformSessionMeta | null;
  rehydrate?: boolean;
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
  const harnessLoadTimeoutMs =
    deps.harnessLoadTimeoutMs ?? DEFAULT_HARNESS_LOAD_TIMEOUT_MS;
  let sessionCloseSupported = true;
  const engagedSessions = new Map<ClientChannel, Set<string>>();
  const nonViewerChannels = new Set<ClientChannel>();
  const outboundIdToClient = new Map<number, OutboundMapping>();

  function engagedChannelsFor(sessionId: string): ClientChannel[] {
    const channels: ClientChannel[] = [];
    for (const [channel, sessions] of engagedSessions) {
      if (sessions.has(sessionId)) channels.push(channel);
    }
    return channels;
  }

  const promptScheduler = createPromptScheduler({
    sendToAgent: (frame) => lease.send(frame),
    onTurnStarted: ({ sessionId, channel }) => {
      if (!nonViewerChannels.has(channel)) return;
      const meta = deps.sessionMetadata?.get(sessionId)?.meta;
      if (meta?.type === SessionType.ScheduleCron || meta?.scheduleId)
        deps.sessionMetadata?.startRun(sessionId);
    },
    onTurnEnded: (sessionId) => deps.sessionMetadata?.finishRun(sessionId),
  });

  const sessionIsRunning = (sessionId: string): boolean =>
    promptScheduler.hasTurnInFlight(sessionId) ||
    (deps.isTerminalSessionActive?.(sessionId) ?? false);

  const transcript = createSessionTranscript({
    logBytesCap,
    replayTailEvents: deps.replayTailEvents ?? DEFAULT_REPLAY_TAIL_EVENTS,
    engagedChannelsFor,
  });

  const pendingRequests = createPendingAgentRequests({
    orphanTtlMs,
    channelsFor(sessionId) {
      return sessionId === null
        ? [...engagedSessions.keys()]
        : engagedChannelsFor(sessionId);
    },
    sendToAgent(frame) {
      lease.send(frame);
    },
    onExpired() {
      lease.maybeRecycle();
    },
  });

  let nextOutboundId = 1;

  const bootstrap = createSessionBootstrap({
    transcript,
    engage(channel, sessionId) {
      engage(channel, sessionId);
    },
    openLoadRoute(sessionId) {
      const outboundId = nextOutboundId++;
      outboundIdToClient.set(outboundId, {
        channel: null,
        originalId: null,
        method: "session/load",
        promptSessionId: null,
        attachSessionId: sessionId,
        platformMeta: null,
      });
      return outboundId;
    },
    sendToAgent(frame) {
      lease.send(frame);
    },
    workingDir: deps.workingDir,
    loadTimeoutMs: harnessLoadTimeoutMs,
    log(msg) {
      deps.log?.(msg);
    },
    historyProvider: deps.historyProvider,
    onProviderServed(sessionId) {
      harnessColdSessions.add(sessionId);
    },
    harnessLoadOrphaned(sessionId) {
      return orphanedHarnessLoads.has(sessionId);
    },
    onLoadOrphaned(sessionId, outboundId) {
      orphanLoad(sessionId, outboundId);
    },
  });

  const idleReapTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const harnessColdSessions = new Set<string>();
  const rehydratingSessions = new Set<string>();
  const rehydrateTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const rehydrateLoadIds = new Map<string, number>();
  const orphanedHarnessLoads = new Map<string, number>();
  const heldPrompts = new Map<
    string,
    { channel: ClientChannel; data: string }[]
  >();

  function orphanLoad(sessionId: string, outboundId: number): void {
    orphanedHarnessLoads.set(sessionId, outboundId);
    deps.log?.(
      `harness left session/load for ${sessionId} unanswered; ` +
        `suppressing its frames and recycling the harness`,
    );
    lease.requestRecycle();
  }

  function settleOrphanedLoad(
    sessionId: string | null,
    outboundId: number,
  ): boolean {
    if (sessionId === null) return false;
    if (orphanedHarnessLoads.get(sessionId) !== outboundId) return false;
    orphanedHarnessLoads.delete(sessionId);
    deps.log?.(`orphaned session/load for ${sessionId} answered late; dropped`);
    return true;
  }

  function startHarnessRehydrate(sessionId: string): void {
    rehydratingSessions.add(sessionId);
    rehydrateTimers.set(
      sessionId,
      setTimeout(() => {
        if (!rehydratingSessions.has(sessionId)) return;
        deps.log?.(`rehydrate of ${sessionId} timed out`);
        const pendingLoadId = rehydrateLoadIds.get(sessionId);
        finishHarnessRehydrate(sessionId, {
          error: {
            code: -32000,
            message: "the harness did not answer the session load in time",
          },
        });
        if (pendingLoadId !== undefined) orphanLoad(sessionId, pendingLoadId);
      }, harnessLoadTimeoutMs),
    );
    const outboundId = nextOutboundId++;
    rehydrateLoadIds.set(sessionId, outboundId);
    outboundIdToClient.set(outboundId, {
      channel: null,
      originalId: null,
      method: "session/load",
      promptSessionId: null,
      attachSessionId: sessionId,
      platformMeta: null,
      rehydrate: true,
    });
    lease.send(
      rewriteCwd(
        {
          jsonrpc: "2.0",
          id: outboundId,
          method: "session/load",
          params: { sessionId, cwd: ".", mcpServers: [] },
        },
        deps.workingDir,
      ),
    );
  }

  function finishHarnessRehydrate(sessionId: string, frame: unknown): void {
    const timer = rehydrateTimers.get(sessionId);
    if (timer) clearTimeout(timer);
    rehydrateTimers.delete(sessionId);
    rehydrateLoadIds.delete(sessionId);
    rehydratingSessions.delete(sessionId);
    const held = heldPrompts.get(sessionId) ?? [];
    heldPrompts.delete(sessionId);
    const error = (frame as { error?: unknown }).error;
    if (error === undefined) {
      harnessColdSessions.delete(sessionId);
      for (const prompt of held) {
        if (prompt.channel.isOpen())
          handleClientMessage(prompt.channel, prompt.data);
      }
      return;
    }
    for (const prompt of held) {
      if (!prompt.channel.isOpen()) continue;
      const parsed = parseFrame(prompt.data);
      if (!parsed || !isRequest(parsed)) continue;
      prompt.channel.send(
        rewriteAuthError(
          JSON.stringify({ jsonrpc: "2.0", id: parsed.id, error }),
        ),
      );
    }
  }

  const teardownCloseByReason: Record<
    HarnessTeardownReason,
    { code: number; message: string }
  > = {
    "agent-exited": { code: 1011, message: "agent exited" },
    "env-recycle": { code: 1011, message: "agent recycled for env change" },
    "harness-unresponsive": {
      code: 1011,
      message: "agent restarted after it stopped answering",
    },
    shutdown: { code: 1000, message: "shutdown" },
  };

  function teardownRuntime(reason: HarnessTeardownReason): void {
    const close = teardownCloseByReason[reason];
    for (const channel of engagedSessions.keys()) {
      channel.close(close.code, close.message);
    }
    engagedSessions.clear();
    transcript.clear();
    bootstrap.clear();
    pendingRequests.clear();
    for (const t of idleReapTimers.values()) clearTimeout(t);
    idleReapTimers.clear();
    for (const t of rehydrateTimers.values()) clearTimeout(t);
    rehydrateTimers.clear();
    rehydrateLoadIds.clear();
    orphanedHarnessLoads.clear();
    promptScheduler.clear();
    harnessColdSessions.clear();
    rehydratingSessions.clear();
    heldPrompts.clear();
    deps.backgroundWork?.clear();
  }

  function describeBusy(): string {
    return (
      `${promptScheduler.activeTurnCount()} turn(s), ` +
      `${pendingRequests.size()} pending request(s), ` +
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

    pendingRequests.onEngaged(channel, sessionId);
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

  function runtimeBusy(): boolean {
    if (promptScheduler.anyWork() || pendingRequests.any()) return true;
    return (deps.backgroundWork?.held().length ?? 0) > 0;
  }

  deps.backgroundWork?.onRelease(() => lease.maybeRecycle());

  function detach(channel: ClientChannel): void {
    const sessions = engagedSessions.get(channel);
    engagedSessions.delete(channel);
    nonViewerChannels.delete(channel);
    transcript.dropChannel(channel);
    promptScheduler.dropChannel(channel);
    bootstrap.dropChannel(channel);
    for (const [sid, held] of heldPrompts) {
      const remaining = held.filter((p) => p.channel !== channel);
      if (remaining.length === 0) heldPrompts.delete(sid);
      else heldPrompts.set(sid, remaining);
    }

    for (const [outId, m] of outboundIdToClient) {
      if (m.channel === channel && m.promptSessionId === null) {
        outboundIdToClient.delete(outId);
      }
    }

    if (sessions) {
      for (const sid of sessions) {
        pendingRequests.reassess(sid);
        maybeCloseIdleSession(sid);
      }
    }
  }

  function tearDownSession(sessionId: string): void {
    if (sessionCloseSupported && !harnessColdSessions.has(sessionId)) {
      lease.send({
        jsonrpc: "2.0",
        id: nextOutboundId++,
        method: "session/close",
        params: { sessionId },
      });
    }
    harnessColdSessions.delete(sessionId);
    rehydratingSessions.delete(sessionId);
    const rehydrateTimer = rehydrateTimers.get(sessionId);
    if (rehydrateTimer) clearTimeout(rehydrateTimer);
    rehydrateTimers.delete(sessionId);
    rehydrateLoadIds.delete(sessionId);
    heldPrompts.delete(sessionId);
    transcript.forget(sessionId);
    promptScheduler.forget(sessionId);
    pendingRequests.forget(sessionId);
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
    if (bootstrap.has(sessionId)) return;
    if (pendingRequests.hasFor(sessionId)) return;
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

  function handleAgentLine(line: string): void {
    const frame = parseFrame(line);

    if (frame && isRequest(frame)) {
      pendingRequests.onAgentRequest(
        frame.id,
        extractAgentRequestSessionId(frame),
        line,
      );
      return;
    }

    if (frame && isResponse(frame)) {
      const outboundId = frame.id as number;
      const mapping = outboundIdToClient.get(outboundId);
      if (mapping) {
        outboundIdToClient.delete(outboundId);

        if (settleOrphanedLoad(mapping.attachSessionId, outboundId)) return;

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
          if (mapping.rehydrate) {
            finishHarnessRehydrate(mapping.attachSessionId, frame);
          } else {
            bootstrap.onLoadResponse(mapping.attachSessionId, frame);
          }
        }

        if (mapping.channel && mapping.originalId !== null) {
          const responseFrame =
            mapping.method === "session/list" && deps.sessionMetadata
              ? injectPlatformMetaIntoList(
                  frame,
                  deps.sessionMetadata,
                  sessionIsRunning,
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
      const touch = deps.onArtifactTouch ? artifactTouchIn(frame) : null;
      if (touch) deps.onArtifactTouch?.(touch);
      if (
        orphanedHarnessLoads.has(sessionId) ||
        rehydratingSessions.has(sessionId)
      ) {
        return;
      }
      if (bootstrap.has(sessionId)) {
        transcript.appendReplay(sessionId, line);
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
      pendingRequests.answer(frame);
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

      if (method === "platform/markSeen" && paramsSid) {
        deps.sessionMetadata?.recordSeen(paramsSid);
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
        bootstrap.requestResume(channel, frame.id, paramsSid);
        return;
      }

      if (method === "session/load" && paramsSid) {
        const replayBefore = extractReplayBefore(frame);
        const loadToken = extractLoadToken(frame) ?? undefined;
        if (replayBefore !== null) {
          bootstrap.requestPage(channel, frame.id, paramsSid, replayBefore, {
            loadToken,
          });
        } else {
          bootstrap.requestLoad(channel, frame.id, paramsSid, {
            tail: extractTailFlag(frame),
            loadToken,
          });
        }
        return;
      }

      if (
        method === "session/prompt" &&
        paramsSid &&
        harnessColdSessions.has(paramsSid)
      ) {
        if (orphanedHarnessLoads.has(paramsSid)) {
          sendToChannel(
            channel,
            rewriteAuthError(
              JSON.stringify({
                jsonrpc: "2.0",
                id: frame.id,
                error: {
                  code: -32000,
                  message:
                    "the harness is not answering; it is being restarted — try again",
                },
              }),
            ),
          );
          return;
        }
        const held = heldPrompts.get(paramsSid) ?? [];
        held.push({ channel, data });
        heldPrompts.set(paramsSid, held);
        if (!rehydratingSessions.has(paramsSid)) {
          startHarnessRehydrate(paramsSid);
        }
        return;
      }

      const outboundId = nextOutboundId++;

      if (paramsSid) engage(channel, paramsSid);

      const promptSessionId = method === "session/prompt" ? paramsSid : null;

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
        attachSessionId: null,
        platformMeta,
      });

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

    isSessionRunning(sessionId) {
      return sessionIsRunning(sessionId);
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

function extractTailFlag(frame: unknown): boolean {
  if (!isNonNullObject(frame)) return false;
  const params = frame.params;
  if (!isNonNullObject(params)) return false;
  const meta = params._meta;
  if (!isNonNullObject(meta)) return false;
  const platform = meta.platform;
  if (!isNonNullObject(platform)) return false;
  return platform.tail === true;
}

function extractReplayBefore(frame: unknown): string | null {
  if (!isNonNullObject(frame)) return null;
  const params = frame.params;
  if (!isNonNullObject(params)) return null;
  const meta = params._meta;
  if (!isNonNullObject(meta)) return null;
  const platform = meta.platform;
  if (!isNonNullObject(platform)) return null;
  const replayBefore = platform.replayBefore;
  return typeof replayBefore === "string" && replayBefore.length > 0
    ? replayBefore
    : null;
}

function extractLoadToken(frame: unknown): string | null {
  if (!isNonNullObject(frame)) return null;
  const params = frame.params;
  if (!isNonNullObject(params)) return null;
  const meta = params._meta;
  if (!isNonNullObject(meta)) return null;
  const platform = meta.platform;
  if (!isNonNullObject(platform)) return null;
  const loadToken = platform.loadToken;
  return typeof loadToken === "string" && loadToken.length > 0
    ? loadToken
    : null;
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

function toAcpPlatformMeta(session: PodSession): Record<string, unknown> {
  return {
    mode: session.mode,
    type: session.type,
    createdAt: session.createdAt,
    running: session.running,
    ...(session.scheduleId !== null && { scheduleId: session.scheduleId }),
    ...(session.experimentId !== null && {
      experimentId: session.experimentId,
    }),
    ...(session.threadTs !== null && { threadTs: session.threadTs }),
    ...(session.seenAt !== null && { seenAt: session.seenAt }),
    ...(session.runStartedAt !== null && {
      runStartedAt: session.runStartedAt,
    }),
    ...(session.runTotalMs !== null && { runTotalMs: session.runTotalMs }),
    ...(session.runCount !== null && { runCount: session.runCount }),
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

  const listed: ListedHarnessSession[] = [];
  const originals = new Map<string, Record<string, unknown>>();
  for (const raw of Array.isArray(result.sessions) ? result.sessions : []) {
    if (!isNonNullObject(raw) || typeof raw.sessionId !== "string") continue;
    originals.set(raw.sessionId, raw);
    listed.push(raw as unknown as ListedHarnessSession);
  }

  const sessions = composeSessionList(listed, store.all(), {
    isTombstoned: (sessionId) => store.isTombstoned(sessionId),
    isRunning,
  }).map((session) => {
    const original = originals.get(session.sessionId) ?? {};
    const existingMeta = isNonNullObject(original._meta) ? original._meta : {};
    return {
      ...original,
      sessionId: session.sessionId,
      title: session.title,
      updatedAt: session.updatedAt,
      _meta: { ...existingMeta, platform: toAcpPlatformMeta(session) },
    };
  });

  return { ...frame, result: { ...result, sessions } };
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

function extractAgentRequestSessionId(frame: unknown): string | null {
  const sid = extractParamsSessionId(frame);
  return sid === "" ? null : sid;
}

function extractResultSessionId(frame: unknown): string | null {
  if (!isNonNullObject(frame)) return null;
  const result = frame.result;
  if (!isNonNullObject(result)) return null;
  const sid = result.sessionId;
  return typeof sid === "string" ? sid : null;
}
