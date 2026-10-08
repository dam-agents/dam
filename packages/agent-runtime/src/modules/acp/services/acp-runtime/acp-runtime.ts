import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import type { PodSession } from "agent-runtime-api";
import {
  buildPlatformQueueChangedNotification,
  buildPlatformRunStartedNotification,
  capInlineImages,
  buildPlatformTurnEndedNotification,
  jsonRpcErrorDetails,
  platformRemoveQueuedParamsSchema,
  platformRewriteFromParamsSchema,
  platformUndeliveredPromptSchema,
  platformUpdateQueuedParamsSchema,
  PROMPT_NOT_QUEUED_CODE,
  PROMPT_NOT_QUEUED_MESSAGE,
  promptBlockSchema,
  REWRITE_REFUSED_CODE,
  SessionType,
  STEER_METHOD,
  steerResponseSchema,
  steeringSupported,
  type PromptBlock,
  type PlatformTurnEndedParams,
  type PlatformRewriteFromParams,
  type PlatformUpdateQueuedParams,
  type PlatformUndeliveredPrompt,
} from "api-server-api";

import {
  artifactTouchIn,
  type ArtifactTouch,
} from "../../infrastructure/artifact-touch.js";
import {
  subAgentSpawnIn,
  type SubAgentSpawn,
} from "../../infrastructure/sub-agent-spawn.js";
import { frameDirectTurn, isDirectSurface } from "../../domain/direct-turn.js";
import {
  isNonNullObject,
  isRequest,
  isResponse,
  parseFrame,
  type JsonRpcId,
} from "../../domain/frames.js";
import {
  harnessLostSession,
  rewriteAuthError,
  rewriteCwd,
  undeliveredOf,
} from "../../domain/mappers.js";
import {
  composeSessionList,
  type ListedHarnessSession,
} from "../../domain/session-list.js";
import type { AgentProcess } from "../../infrastructure/agent-process.js";
import type { ClientChannel } from "../../infrastructure/client-channel.js";
import type { HistoryProvider } from "../../infrastructure/history-provider.js";
import type { PlatformSessionOf } from "../../infrastructure/terminal-session-pins.js";
import {
  platformSessionMetaSchema,
  type PlatformSessionMeta,
  type SessionMetadataStore,
} from "../../infrastructure/session-metadata-store.js";
import type { RunResultStore } from "../../infrastructure/run-result-store.js";
import type { UndeliveredPromptStore } from "../../infrastructure/undelivered-prompt-store.js";
import type { ActiveTurnStore } from "../../infrastructure/active-turn-store.js";
import type {
  BackgroundWorkRegistry,
  HeldSession,
} from "../background-work-registry.js";
import {
  createHarnessLease,
  type HarnessTeardownReason,
} from "./harness-lease.js";
import { createPendingAgentRequests } from "./pending-agent-requests.js";
import { createAutonomousTurns } from "./autonomous-turns.js";
import {
  createPromptScheduler,
  type PromptSubmission,
  type SteerOutcome,
} from "./prompt-scheduler.js";
import { createSessionBootstrap } from "./session-bootstrap.js";
import { createSessionTranscript } from "./session-transcript.js";
import { MAX_RESUME_ATTEMPTS } from "../interrupted-turn-recovery.js";

const DEFAULT_ORPHAN_TTL_MS = 10 * 60 * 1000;

const DEFAULT_ENV_FORCE_RECYCLE_MS = 60 * 1000;

const DEFAULT_WARM_START_TIMEOUT_MS = 15 * 1000;

const DEFAULT_LOG_BYTES_CAP = 2 * 1024 * 1024;

const DEFAULT_REPLAY_TAIL_EVENTS = 200;

const DEFAULT_HARNESS_LOAD_TIMEOUT_MS = 30 * 1000;

const SESSION_SETTING_METHODS = new Set([
  "session/set_config_option",
  "session/set_mode",
  "session/set_model",
]);

const DEFAULT_BACKGROUND_WORK_RECHECK_MS = 15 * 1000;

const RUN_TEXT_BYTES_CAP = 1024 * 1024;

const TURN_ERROR_TEXT_CAP = 4 * 1024;

export interface AcpRuntimeStatus {
  idle: boolean;
  backgroundWork: HeldSession[];
}

export interface AcpRuntime {
  attach(channel: ClientChannel, opts?: { viewer?: boolean }): void;
  status(): AcpRuntimeStatus;
  isSessionRunning(sessionId: string): boolean;
  sessionFrames(sessionId: string): { frames: string[]; truncated: boolean };
  resetSession(sessionId: string): void;
  refreshEnv(opts: { force: boolean }): void;
  recycleForConfig(): void;
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
  beforeFirstSpawn?: () => Promise<void>;
  logBytesCap?: number;
  replayTailEvents?: number;
  harnessLoadTimeoutMs?: number;
  historyProvider?: HistoryProvider;
  terminalSessionPins?: () => PlatformSessionOf;
  sessionMetadata?: SessionMetadataStore;
  backgroundWork?: BackgroundWorkRegistry;
  backgroundWorkRecheckMs?: number;
  queueParkMs?: number;
  undeliveredPrompts: UndeliveredPromptStore;
  activeTurns: ActiveTurnStore;
  runResults?: RunResultStore;
  sessionMcpServers?: (ref: string) => unknown[];
  onReportableTurnEnded?: (report: ReportableTurn) => void;
  isTerminalSessionActive?: (sessionId: string) => boolean;
  onArtifactTouch: (touch: ArtifactTouch) => void;
  onSubAgentSpawn?: (spawn: SubAgentSpawn) => void;
}

export const SCHEDULE_SURFACE = "schedule";

export interface ReportableTurn {
  sessionId: string;
  reportTo: string;
  reportName: string;
  text: string;
  truncated: boolean;
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
  let sessionResumeSupported = false;
  let harnessSteers = false;
  let sessionForkSupported = false;
  const ownRequests = new Map<number, (frame: unknown) => void>();
  let initializeAnswer: { result?: unknown; error?: unknown } | null = null;
  let initializeWaiters: { channel: ClientChannel; id: unknown }[] | null =
    null;
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

  const isMachineSession = (sessionId: string): boolean => {
    const meta = deps.sessionMetadata?.get(sessionId)?.meta;
    return (
      meta?.type === SessionType.ScheduleCron ||
      meta?.type === SessionType.ScheduleOnce ||
      Boolean(meta?.scheduleId)
    );
  };

  let shuttingDown = false;

  const autonomousTurns = createAutonomousTurns({
    onEnded: (sessionId, turnId) =>
      transcript.append(
        sessionId,
        JSON.stringify(
          buildPlatformTurnEndedNotification({ sessionId, turnId }),
        ),
      ),
  });

  const promptScheduler = createPromptScheduler({
    sendToAgent: (frame) => lease.send(frame),
    onTurnStarted: ({
      sessionId,
      unattended,
      typed,
      channel,
      promptId,
      queuedAt,
    }) => {
      autonomousTurns.end(sessionId);
      appendUserPromptToLog(
        sessionId,
        typed,
        queuedAt === undefined ? channel : null,
        promptId ?? randomUUID(),
      );
      deps.activeTurns.record(sessionId);
      if (unattended === true) {
        const at = deps.sessionMetadata?.startRun(sessionId);
        if (at) announceRunStart(sessionId, at);
      }
    },
    canSteer: () => harnessSteers,
    steer: (entry) => steerIntoTurn(entry),
    onSteered: (
      { sessionId, typed, channel, promptId, outboundId, originalId, queuedAt },
      turnEnded,
    ) => {
      outboundIdToClient.delete(outboundId);
      appendUserPromptToLog(
        sessionId,
        typed,
        queuedAt === undefined ? channel : null,
        promptId ?? randomUUID(),
        { steered: true },
      );
      if (turnEnded) answerSteered({ channel, originalId }, null);
    },
    onQueueChanged: (sessionId) => announceQueue(sessionId),
    onTurnEnded: (sessionId) => {
      if (shuttingDown) return;
      deps.sessionMetadata?.finishRun(sessionId);
      deps.activeTurns.remove(sessionId);
    },
    onTurnInterrupted: (sessionId, turn) => {
      if (!turn.runPrompt && !isRunSession(sessionId)) return;
      const buffer = runTextBuffers.get(sessionId);
      runTextBuffers.delete(sessionId);
      deps.runResults?.record(sessionId, {
        promptId: turn.promptId,
        stopReason: null,
        finalText: buffer?.text ?? "",
        truncated: buffer?.truncated ?? false,
        endedAt: new Date().toISOString(),
      });
    },
    canStart: ({ sessionId, unattended }) =>
      (unattended === true || hasEngagedChannel(sessionId)) &&
      !harnessColdSessions.has(sessionId),
    sessionLoaded: (sessionId) => !harnessColdSessions.has(sessionId),
    onQueueDropped(sessionId, dropped, cause) {
      const recordedAt = new Date().toISOString();
      deps.undeliveredPrompts.remember(
        sessionId,
        dropped.map((entry) =>
          undeliveredOf(
            entry.promptId ?? randomUUID(),
            entry.frame,
            recordedAt,
          ),
        ),
      );
      deps.log?.(
        `${String(dropped.length)} queued prompt(s) for ${sessionId} undelivered: ${cause}`,
      );
      if (cause === "park-expired") maybeCloseIdleSession(sessionId);
    },
    ...(deps.queueParkMs !== undefined
      ? { queueParkMs: deps.queueParkMs }
      : {}),
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
    turnInFlight(sessionId) {
      return promptScheduler.hasTurnInFlight(sessionId);
    },
    interruptedAt(sessionId) {
      if (promptScheduler.hasTurnInFlight(sessionId)) return undefined;
      return deps.activeTurns.leftovers().find((m) => m.sessionId === sessionId)
        ?.startedAt;
    },
    undeliveredFor(sessionId) {
      return deps.undeliveredPrompts.readFor(sessionId);
    },
    queueOf(sessionId) {
      return promptScheduler.snapshot(sessionId);
    },
    supersededFor(sessionId) {
      return [...(supersededEchoes.get(sessionId) ?? [])];
    },
    runStartsOf(sessionId) {
      return deps.sessionMetadata?.runStartsOf(sessionId) ?? [];
    },
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
    mcpServersFor,
  });

  const idleReapTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const harnessColdSessions = new Set<string>();
  const turnModels = new Map<string, string>();
  const runTextBuffers = new Map<
    string,
    { text: string; truncated: boolean }
  >();

  function isRunSession(sessionId: string): boolean {
    const meta = deps.sessionMetadata?.get(sessionId)?.meta;
    return meta?.type === SessionType.CliRun || meta?.reportTo !== undefined;
  }

  function refFor(sessionId: string): string {
    const current = deps.sessionMetadata?.get(sessionId)?.meta;
    if (current?.ref) return current.ref;
    const ref = randomUUID();
    deps.sessionMetadata?.set(sessionId, { ...current, ref });
    return ref;
  }

  function mcpServersFor(sessionId: string): unknown[] {
    return deps.sessionMcpServers?.(refFor(sessionId)) ?? [];
  }

  function reportTurnEnd(
    sessionId: string,
    buffer: { text: string; truncated: boolean } | undefined,
  ): void {
    const meta = deps.sessionMetadata?.get(sessionId)?.meta;
    if (!meta?.reportTo) return;
    const { reportTo, reportName, ...rest } = meta;
    deps.sessionMetadata?.set(sessionId, rest);
    deps.onReportableTurnEnded?.({
      sessionId,
      reportTo,
      reportName: reportName ?? "one-time task",
      text: buffer?.text ?? "",
      truncated: buffer?.truncated ?? false,
    });
  }

  function accumulateRunText(sessionId: string, text: string): void {
    const buffer = runTextBuffers.get(sessionId) ?? {
      text: "",
      truncated: false,
    };
    if (buffer.truncated) return;
    if (buffer.text.length + text.length > RUN_TEXT_BYTES_CAP) {
      buffer.text += text.slice(0, RUN_TEXT_BYTES_CAP - buffer.text.length);
      buffer.truncated = true;
    } else {
      buffer.text += text;
    }
    runTextBuffers.set(sessionId, buffer);
  }
  const supersededEchoes = new Map<string, Set<string>>();

  function supersedeEcho(sessionId: string, id: string): void {
    const ids = supersededEchoes.get(sessionId) ?? new Set<string>();
    ids.add(id);
    supersededEchoes.set(sessionId, ids);
  }
  const rehydratingSessions = new Set<string>();
  const rehydrateTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const rehydrateLoadIds = new Map<string, number>();
  const orphanedHarnessLoads = new Map<string, number>();

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
    if (orphanedHarnessLoads.size === 0) lease.cancelRecycleRequest();
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
    const method = sessionResumeSupported ? "session/resume" : "session/load";
    outboundIdToClient.set(outboundId, {
      channel: null,
      originalId: null,
      method,
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
          method,
          params: { sessionId, cwd: ".", mcpServers: mcpServersFor(sessionId) },
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
    const error = (frame as { error?: unknown }).error;
    if (error === undefined) {
      harnessColdSessions.delete(sessionId);
      promptScheduler.onSessionReady(sessionId);
      return;
    }
    promptScheduler.refuseQueue(sessionId, rehydrateFailureMessage(error));
  }

  const teardownCloseByReason: Record<
    HarnessTeardownReason,
    { code: number; message: string }
  > = {
    "agent-exited": { code: 1011, message: "agent exited" },
    "config-recycle": {
      code: 1011,
      message: "agent recycled for config change",
    },
    "env-recycle": { code: 1011, message: "agent recycled for env change" },
    "harness-unresponsive": {
      code: 1011,
      message: "agent restarted after it stopped answering",
    },
    shutdown: { code: 1000, message: "shutdown" },
  };

  function teardownRuntime(reason: HarnessTeardownReason): void {
    shuttingDown = reason === "shutdown";
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
    autonomousTurns.clear();
    runTextBuffers.clear();
    turnModels.clear();
    harnessColdSessions.clear();
    rehydratingSessions.clear();
    sessionCloseSupported = true;
    sessionResumeSupported = false;
    harnessSteers = false;
    sessionForkSupported = false;
    const unanswered = [...ownRequests.values()];
    ownRequests.clear();
    for (const reply of unanswered)
      reply({ error: { code: -32000, message: "the harness went down" } });
    initializeAnswer = null;
    initializeWaiters = null;
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
    ...(deps.beforeFirstSpawn
      ? { beforeFirstSpawn: deps.beforeFirstSpawn }
      : {}),
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
    promptScheduler.onEngaged(sessionId);
  }

  function hasEngagedChannel(sessionId: string): boolean {
    for (const [channel, sessions] of engagedSessions) {
      if (sessions.has(sessionId) && channel.isOpen()) return true;
    }
    return false;
  }

  function* engagedViewersOf(sessionId: string): Generator<ClientChannel> {
    for (const [channel, sessions] of engagedSessions) {
      if (
        sessions.has(sessionId) &&
        channel.isOpen() &&
        !nonViewerChannels.has(channel)
      )
        yield channel;
    }
  }

  function announceRunStart(sessionId: string, at: string): void {
    const line = JSON.stringify(
      buildPlatformRunStartedNotification({ sessionId, at }),
    );
    for (const channel of engagedViewersOf(sessionId)) channel.send(line);
  }

  function promptFrameFor(
    source: unknown,
    sessionId: string,
    outboundId: number,
  ): object {
    const forward = stripPlatformMeta(source);
    const framed =
      isDirectSurface(platformString(source, "surface")) &&
      deps.sessionMetadata?.get(sessionId)?.meta.threadTs !== undefined
        ? frameDirectTurn(forward)
        : forward;
    return rewriteCwd({ ...framed, id: outboundId }, deps.workingDir);
  }

  function updateQueuedPrompt(
    sessionId: string,
    { promptId, prompt }: PlatformUpdateQueuedParams,
  ): boolean {
    return promptScheduler.update(sessionId, promptId, (entry) => {
      const source = isNonNullObject(entry.source) ? entry.source : {};
      const params = isNonNullObject(source.params) ? source.params : {};
      const edited = { ...source, params: { ...params, prompt } };
      return {
        source: edited,
        frame: promptFrameFor(edited, sessionId, entry.outboundId),
        typed: prompt,
        blocks: queueableBlocks(prompt),
      };
    });
  }

  function answerQueueEdit(
    channel: ClientChannel,
    id: unknown,
    done: boolean,
  ): void {
    sendToChannel(
      channel,
      JSON.stringify(
        done
          ? { jsonrpc: "2.0", id, result: {} }
          : {
              jsonrpc: "2.0",
              id,
              error: {
                code: -32000,
                message: PROMPT_NOT_QUEUED_MESSAGE,
                data: { code: PROMPT_NOT_QUEUED_CODE },
              },
            },
      ),
    );
  }

  function answerSteered(
    { channel, originalId }: Pick<PromptSubmission, "channel" | "originalId">,
    stopReason: string | null,
  ): void {
    if (originalId === null) return;
    sendToChannel(
      channel,
      JSON.stringify({
        jsonrpc: "2.0",
        id: originalId,
        result: { stopReason: stopReason ?? "end_turn" },
      }),
    );
  }

  function requestFromHarness(
    method: string,
    params: Record<string, unknown>,
    onReply: (frame: unknown) => void,
  ): void {
    const outboundId = nextOutboundId++;
    ownRequests.set(outboundId, onReply);
    if (
      lease.send(
        rewriteCwd(
          { jsonrpc: "2.0", id: outboundId, method, params },
          deps.workingDir,
        ),
      )
    )
      return;
    ownRequests.delete(outboundId);
    onReply({ error: { code: -32000, message: "the harness is not running" } });
  }

  function steerIntoTurn(entry: PromptSubmission): Promise<SteerOutcome> {
    const params = (entry.frame as { params?: { prompt?: unknown } }).params;
    return new Promise((resolve) => {
      requestFromHarness(
        STEER_METHOD,
        {
          sessionId: entry.sessionId,
          prompt: params?.prompt ?? [],
          _meta: { steering: { idleBehavior: "promptRequired" } },
        },
        (frame) => resolve(steerOutcomeOf(frame)),
      );
    });
  }

  function rewriteRefusal(
    sessionId: string,
    upToMessageId: string | null,
  ): string | null {
    const entry = deps.sessionMetadata?.get(sessionId);
    const meta = entry?.meta;
    if (
      entry === undefined ||
      deps.sessionMetadata?.isTombstoned(sessionId) === true ||
      (meta?.type !== undefined && meta.type !== SessionType.Regular) ||
      meta?.mode === "terminal" ||
      meta?.threadTs !== undefined ||
      meta?.scheduleId !== undefined ||
      meta?.initialization === true
    )
      return "only a chat session can be rewritten";
    if (upToMessageId !== null && !sessionForkSupported)
      return "this agent cannot rewrite a conversation";
    if (
      promptScheduler.hasWork(sessionId) ||
      pendingRequests.hasFor(sessionId) ||
      bootstrap.has(sessionId)
    )
      return "the session is busy; wait until the agent is idle";
    return null;
  }

  function retireSession(sessionId: string): void {
    deps.sessionMetadata?.tombstone(sessionId);
    deps.undeliveredPrompts.forgetSession(sessionId);
    deps.activeTurns.remove(sessionId);
    deps.runResults?.forgetSession(sessionId);
    supersededEchoes.delete(sessionId);
  }

  function rewriteFrom(
    channel: ClientChannel,
    id: unknown,
    params: PlatformRewriteFromParams,
  ): void {
    const fail = (message: string, code?: string): void =>
      sendToChannel(
        channel,
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          error: { code: -32000, message, ...(code && { data: { code } }) },
        }),
      );
    const oldId = params.sessionId;
    const refusal = rewriteRefusal(oldId, params.upToMessageId);
    if (refusal !== null) {
      fail(refusal, REWRITE_REFUSED_CODE);
      return;
    }
    const fresh = params.upToMessageId === null;
    requestFromHarness(
      fresh ? "session/new" : "session/fork",
      {
        ...(fresh ? {} : { sessionId: oldId }),
        cwd: ".",
        mcpServers: [],
        ...(!fresh && {
          _meta: {
            jetbrains: {
              air: { fork: { version: 1, messageId: params.upToMessageId } },
            },
          },
        }),
      },
      (frame) => {
        const newId = extractResultSessionId(frame);
        if (newId === null) {
          fail(
            extractTurnError(frame)?.message ??
              "the harness could not fork the session",
          );
          return;
        }
        if (fresh)
          transcript.cacheMetadata(
            newId,
            (frame as { result?: unknown }).result,
          );
        bootstrap.fill(newId, (loaded) => {
          if (!loaded) {
            fail("the rewritten session could not be loaded");
            return;
          }
          const meta = {
            ...(deps.sessionMetadata?.get(oldId)?.meta ?? {}),
            ...(params.title !== undefined && { title: params.title }),
          };
          if (params.mode === "rewind") {
            deps.sessionMetadata?.adopt(newId, oldId, meta);
            retireSession(oldId);
            tearDownSession(oldId);
          } else {
            deps.sessionMetadata?.set(newId, meta);
          }
          sendToChannel(
            channel,
            JSON.stringify({
              jsonrpc: "2.0",
              id,
              result: { sessionId: newId },
            }),
          );
          submitRewrittenPrompt(channel, newId, params);
        });
      },
    );
  }

  function submitRewrittenPrompt(
    channel: ClientChannel,
    sessionId: string,
    { prompt, promptId }: PlatformRewriteFromParams,
  ): void {
    const outboundId = nextOutboundId++;
    const source = {
      jsonrpc: "2.0",
      id: outboundId,
      method: "session/prompt",
      params: {
        sessionId,
        prompt,
        _meta: { platform: { promptId, surface: "ui" } },
      },
    };
    engage(channel, sessionId);
    outboundIdToClient.set(outboundId, {
      channel,
      originalId: null,
      method: "session/prompt",
      promptSessionId: sessionId,
      attachSessionId: null,
      platformMeta: null,
    });
    deps.sessionMetadata?.recordActivity(sessionId);
    const fate = promptScheduler.submit({
      sessionId,
      channel,
      outboundId,
      originalId: null,
      frame: promptFrameFor(source, sessionId, outboundId),
      promptId,
      source,
      typed: prompt,
      blocks: queueableBlocks(prompt),
      editable: false,
      steerable: true,
    });
    if (fate === "refused") {
      outboundIdToClient.delete(outboundId);
      return;
    }
    if (
      harnessColdSessions.has(sessionId) &&
      !rehydratingSessions.has(sessionId)
    )
      startHarnessRehydrate(sessionId);
  }

  function announceQueue(sessionId: string): void {
    const line = JSON.stringify(
      buildPlatformQueueChangedNotification({
        sessionId,
        items: promptScheduler.snapshot(sessionId),
      }),
    );
    for (const channel of engagedViewersOf(sessionId)) channel.send(line);
  }

  function hasEngagedViewer(sessionId: string): boolean {
    for (const _ of engagedViewersOf(sessionId)) return true;
    return false;
  }

  function appendUserPromptToLog(
    sessionId: string,
    prompt: unknown,
    originator: ClientChannel | null,
    messageId: string,
    meta?: { steered: true },
  ): void {
    if (!Array.isArray(prompt)) return;
    for (const block of prompt) {
      if (!block || typeof block !== "object") continue;
      const update: Record<string, unknown> = {
        sessionUpdate: "user_message_chunk",
        content: block,
        messageId,
        ...(meta !== undefined && { _meta: meta }),
      };
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
    bootstrap.dropChannel(channel);
    for (const [outId, m] of outboundIdToClient) {
      if (m.channel === channel && m.promptSessionId === null) {
        outboundIdToClient.delete(outId);
      }
    }

    if (sessions) {
      for (const sid of sessions) {
        promptScheduler.onDetached(sid);
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
    autonomousTurns.end(sessionId);
    transcript.forget(sessionId);
    supersededEchoes.delete(sessionId);
    promptScheduler.forget(sessionId);
    runTextBuffers.delete(sessionId);
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
      const ownReply = ownRequests.get(outboundId);
      if (ownReply) {
        ownRequests.delete(outboundId);
        ownReply(frame);
        return;
      }
      const mapping = outboundIdToClient.get(outboundId);
      if (mapping) {
        outboundIdToClient.delete(outboundId);

        if (settleOrphanedLoad(mapping.attachSessionId, outboundId)) return;

        if (mapping.method === "initialize") {
          sessionCloseSupported = hasSessionCapability(frame, "close");
          sessionResumeSupported = hasSessionCapability(frame, "resume");
          sessionForkSupported = hasSessionCapability(frame, "fork");
          harnessSteers = steeringSupported(
            (frame as { result?: unknown }).result,
          );
          const { result, error } = frame as {
            result?: unknown;
            error?: unknown;
          };
          for (const w of initializeWaiters ?? [])
            sendToChannel(
              w.channel,
              JSON.stringify({ jsonrpc: "2.0", id: w.id, result, error }),
            );
          initializeWaiters = null;
          if (result !== undefined) initializeAnswer = { result };
        }

        const sidFromResult = extractResultSessionId(frame);
        const sidForChannel = sidFromResult ?? mapping.attachSessionId;
        if (sidForChannel) {
          if (mapping.channel) engage(mapping.channel, sidForChannel);
          const cacheable =
            mapping.method === "session/new" ||
            mapping.method === "session/fork" ||
            mapping.method === "session/load" ||
            mapping.method === "session/resume";
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

        if (mapping.attachSessionId) {
          if (mapping.rehydrate) {
            finishHarnessRehydrate(mapping.attachSessionId, frame);
          } else if (mapping.method === "session/load") {
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
                  deps.terminalSessionPins?.(),
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
          const lost = harnessLostSession(frame);
          if (lost) {
            deps.log?.(
              `harness lost session ${sid}; the next prompt loads it back`,
            );
            harnessColdSessions.add(sid);
          }
          const { turnEnded, promptId, turnId, runPrompt, steered } =
            promptScheduler.onPromptResponse(sid, outboundId);
          for (const follower of steered)
            answerSteered(follower, extractStopReason(frame));
          if (
            lost &&
            promptScheduler.hasWork(sid) &&
            !rehydratingSessions.has(sid)
          )
            startHarnessRehydrate(sid);
          deps.sessionMetadata?.recordActivity(sid);
          if (hasEngagedViewer(sid)) deps.sessionMetadata?.recordSeen(sid);
          const stopReason = extractStopReason(frame);
          const error = extractTurnError(frame);
          const model = turnModels.get(sid);
          turnModels.delete(sid);
          transcript.append(
            sid,
            JSON.stringify(
              buildPlatformTurnEndedNotification({
                sessionId: sid,
                ...(promptId !== null && { promptId }),
                ...(turnId !== null && { turnId }),
                ...(stopReason !== null && { stopReason }),
                ...(error !== undefined && { error }),
                ...(model !== undefined && { model }),
              }),
            ),
          );
          if (turnEnded && (runPrompt || isRunSession(sid))) {
            const buffer = runTextBuffers.get(sid);
            runTextBuffers.delete(sid);
            deps.runResults?.record(sid, {
              promptId,
              stopReason,
              finalText: buffer?.text ?? "",
              truncated: buffer?.truncated ?? false,
              endedAt: new Date().toISOString(),
            });
            reportTurnEnd(sid, buffer);
          }
          maybeCloseIdleSession(sid);
          if (turnEnded) lease.maybeRecycle();
        }
      }
      return;
    }

    const sessionId = extractParamsSessionId(frame);
    if (sessionId) {
      if (
        orphanedHarnessLoads.has(sessionId) ||
        rehydratingSessions.has(sessionId)
      ) {
        return;
      }
      if (!bootstrap.has(sessionId)) {
        const touch = artifactTouchIn(frame);
        if (touch) deps.onArtifactTouch(touch);
        const spawn = subAgentSpawnIn(frame);
        if (spawn) deps.onSubAgentSpawn?.(spawn);
      }
      if (bootstrap.has(sessionId)) {
        transcript.appendReplay(sessionId, line);
      } else {
        const reportedModel = extractReportedModel(frame);
        if (reportedModel !== null) turnModels.set(sessionId, reportedModel);
        const text = extractAgentTextChunk(frame);
        if (
          text !== null &&
          (promptScheduler.isRunTurn(sessionId) || isRunSession(sessionId))
        )
          accumulateRunText(sessionId, text);
        const update = sessionUpdateKind(frame);
        const promptTurn = promptScheduler.activeTurnId(sessionId);
        transcript.append(
          sessionId,
          line,
          promptTurn ?? autonomousTurns.turnFor(sessionId, update),
        );
        if (promptTurn === null) autonomousTurns.afterFrame(sessionId, update);
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

      if (method === "platform/updateQueued" && paramsSid) {
        const parsed = platformUpdateQueuedParamsSchema.safeParse(
          (frame as { params?: unknown }).params,
        );
        const updated =
          parsed.success && updateQueuedPrompt(paramsSid, parsed.data);
        answerQueueEdit(channel, frame.id, updated);
        return;
      }

      if (method === "platform/removeQueued" && paramsSid) {
        const parsed = platformRemoveQueuedParamsSchema.safeParse(
          (frame as { params?: unknown }).params,
        );
        const removed = parsed.success
          ? promptScheduler.remove(paramsSid, parsed.data.promptId)
          : null;
        if (removed !== null) {
          outboundIdToClient.delete(removed.outboundId);
          if (removed.originalId !== null)
            sendToChannel(
              removed.channel,
              JSON.stringify({
                jsonrpc: "2.0",
                id: removed.originalId,
                result: { stopReason: "cancelled" },
              }),
            );
        }
        answerQueueEdit(channel, frame.id, removed !== null);
        return;
      }

      if (method === "platform/forgetUndelivered" && paramsSid) {
        const id = extractUndeliveredId(frame);
        if (id !== null && deps.undeliveredPrompts.forget(paramsSid, id))
          supersedeEcho(paramsSid, id);
        sendToChannel(
          channel,
          JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: {} }),
        );
        return;
      }

      if (method === "platform/recordUndelivered" && paramsSid) {
        const prompts = extractUndeliveredPrompts(frame);
        if (prompts === null) {
          sendToChannel(
            channel,
            JSON.stringify({
              jsonrpc: "2.0",
              id: frame.id,
              error: {
                code: -32602,
                message: `expected at most ${String(HANDOVER_PROMPT_CAP)} well-formed undelivered prompts; nothing was recorded`,
              },
            }),
          );
          return;
        }
        const disposed = supersededEchoes.get(paramsSid);
        deps.undeliveredPrompts.remember(
          paramsSid,
          disposed === undefined
            ? prompts
            : prompts.filter((p) => !disposed.has(p.id)),
        );
        sendToChannel(
          channel,
          JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: {} }),
        );
        return;
      }

      if (method === "platform/runResult" && paramsSid) {
        const record = deps.runResults?.readFor(paramsSid) ?? null;
        const leftover = deps.activeTurns
          .leftovers()
          .find((marker) => marker.sessionId === paramsSid);
        const response = promptScheduler.hasWork(paramsSid)
          ? { status: "pending" }
          : leftover !== undefined
            ? leftover.attempts >= MAX_RESUME_ATTEMPTS
              ? { status: "interrupted" }
              : { status: "pending" }
            : record === null
              ? { status: "none" }
              : { status: "done", result: record };
        sendToChannel(
          channel,
          JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: response }),
        );
        return;
      }

      if (method === "platform/rewriteFrom" && paramsSid) {
        const parsed = platformRewriteFromParamsSchema.safeParse(
          (frame as { params?: unknown }).params,
        );
        if (parsed.success) rewriteFrom(channel, frame.id, parsed.data);
        else
          sendToChannel(
            channel,
            JSON.stringify({
              jsonrpc: "2.0",
              id: frame.id,
              error: { code: -32602, message: "invalid rewriteFrom params" },
            }),
          );
        return;
      }

      if (method === "platform/deleteSession" && paramsSid) {
        retireSession(paramsSid);
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
        const replayBefore = platformString(frame, "replayBefore");
        const loadToken = platformString(frame, "loadToken") ?? undefined;
        if (replayBefore !== null) {
          bootstrap.requestPage(channel, frame.id, paramsSid, replayBefore, {
            loadToken,
          });
        } else {
          bootstrap.requestLoad(channel, frame.id, paramsSid, {
            tail: platformField(frame, "tail") === true,
            loadToken,
          });
        }
        return;
      }

      if (method === "initialize" && initializeAnswer !== null) {
        sendToChannel(
          channel,
          JSON.stringify({ jsonrpc: "2.0", id: frame.id, ...initializeAnswer }),
        );
        return;
      }
      if (method === "initialize" && initializeWaiters !== null) {
        initializeWaiters.push({ channel, id: frame.id });
        return;
      }
      if (method === "initialize") initializeWaiters = [];

      const settingSessionId =
        SESSION_SETTING_METHODS.has(method) && paramsSid ? paramsSid : null;

      if (
        (method === "session/prompt" || settingSessionId !== null) &&
        paramsSid &&
        harnessColdSessions.has(paramsSid) &&
        orphanedHarnessLoads.has(paramsSid)
      ) {
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

      const outboundId = nextOutboundId++;

      if (paramsSid !== null) engage(channel, paramsSid);

      const promptSessionId = method === "session/prompt" ? paramsSid : null;

      const platformMeta =
        method === "session/new"
          ? { ...(extractPlatformMeta(frame) ?? {}), ref: randomUUID() }
          : null;
      const promptId =
        method === "session/prompt" ? platformString(frame, "promptId") : null;
      const retryOf =
        method === "session/prompt" ? platformString(frame, "retryOf") : null;
      const strippedFrame =
        platformMeta !== null || method === "session/prompt"
          ? stripPlatformMeta(frame)
          : frame;
      const forwardFrame =
        platformMeta !== null
          ? withMcpServers(
              strippedFrame,
              deps.sessionMcpServers?.(platformMeta.ref) ?? [],
            )
          : strippedFrame;

      const rewritten =
        promptSessionId !== null
          ? promptFrameFor(frame, promptSessionId, outboundId)
          : rewriteCwd({ ...forwardFrame, id: outboundId }, deps.workingDir);
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
        const surface = platformString(frame, "surface");
        const typedPrompt = (frame as { params?: { prompt?: unknown } }).params
          ?.prompt;
        const fate = promptScheduler.submit({
          sessionId: promptSessionId,
          channel,
          outboundId,
          originalId: frame.id,
          frame: rewritten,
          promptId,
          runPrompt: surface === "cli",
          source: frame,
          typed: typedPrompt,
          blocks: queueableBlocks(typedPrompt),
          editable: surface === "ui",
          steerable: surface === "ui",
          unattended:
            nonViewerChannels.has(channel) &&
            (isMachineSession(promptSessionId) ||
              platformString(frame, "surface") === SCHEDULE_SURFACE),
        });
        if (fate === "refused") {
          outboundIdToClient.delete(outboundId);
          return;
        }
        if (
          retryOf !== null &&
          deps.undeliveredPrompts.forget(promptSessionId, retryOf)
        )
          supersedeEcho(promptSessionId, retryOf);
        if (
          harnessColdSessions.has(promptSessionId) &&
          !rehydratingSessions.has(promptSessionId)
        ) {
          startHarnessRehydrate(promptSessionId);
        }
        return;
      }

      if (settingSessionId !== null) {
        const fate = promptScheduler.submitSetting({
          sessionId: settingSessionId,
          channel,
          outboundId,
          originalId: frame.id,
          frame: rewritten,
          promptId: null,
          unattended:
            nonViewerChannels.has(channel) &&
            isMachineSession(settingSessionId),
        });
        if (
          fate === "queued" &&
          harnessColdSessions.has(settingSessionId) &&
          !rehydratingSessions.has(settingSessionId)
        )
          startHarnessRehydrate(settingSessionId);
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

    sessionFrames(sessionId) {
      return transcript.lines(sessionId);
    },

    resetSession(sessionId) {
      tearDownSession(sessionId);
      deps.log?.(`reset session ${sessionId}`);
    },

    refreshEnv(opts) {
      lease.refreshEnv(opts);
    },

    recycleForConfig() {
      lease.recycleForConfig();
    },

    shutdown() {
      lease.shutdown();
    },
  };
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

function platformField(frame: unknown, key: string): unknown {
  if (!isNonNullObject(frame)) return undefined;
  const params = frame.params;
  if (!isNonNullObject(params)) return undefined;
  const meta = params._meta;
  if (!isNonNullObject(meta)) return undefined;
  const platform = meta.platform;
  return isNonNullObject(platform) ? platform[key] : undefined;
}

function platformString(frame: unknown, key: string): string | null {
  const value = platformField(frame, key);
  return typeof value === "string" && value.length > 0 ? value : null;
}

function rehydrateFailureMessage(error: unknown): string {
  if (isNonNullObject(error) && typeof error.message === "string")
    return error.message;
  return "the harness could not load this conversation; the message was not sent";
}

function extractUndeliveredId(frame: unknown): string | null {
  if (!isNonNullObject(frame)) return null;
  const params = frame.params;
  if (!isNonNullObject(params)) return null;
  const id = params.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

const HANDOVER_PROMPT_CAP = 32;

function extractUndeliveredPrompts(
  frame: unknown,
): PlatformUndeliveredPrompt[] | null {
  if (!isNonNullObject(frame)) return null;
  const params = frame.params;
  if (!isNonNullObject(params)) return null;
  const parsed = z
    .array(platformUndeliveredPromptSchema)
    .max(HANDOVER_PROMPT_CAP)
    .safeParse(params.prompts);
  return parsed.success ? parsed.data : null;
}

function withMcpServers(frame: object, extra: unknown[]): object {
  if (extra.length === 0 || !isNonNullObject(frame)) return frame;
  const params = frame.params;
  if (!isNonNullObject(params)) return frame;
  const own = Array.isArray(params.mcpServers) ? params.mcpServers : [];
  return { ...frame, params: { ...params, mcpServers: [...own, ...extra] } };
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
    ...(session.initialization === true && { initialization: true }),
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
  platformSessionOf: PlatformSessionOf | undefined,
): object {
  if (!isNonNullObject(frame)) return frame as object;
  const result = frame.result;
  if (!isNonNullObject(result)) return frame as object;

  const listed: ListedHarnessSession[] = [];
  const originals = new Map<string, Record<string, unknown>>();
  for (const raw of Array.isArray(result.sessions) ? result.sessions : []) {
    if (!isNonNullObject(raw) || typeof raw.sessionId !== "string") continue;
    originals.set(platformSessionOf?.(raw.sessionId) ?? raw.sessionId, raw);
    listed.push(raw as unknown as ListedHarnessSession);
  }

  const sessions = composeSessionList(listed, store.all(), {
    isTombstoned: (sessionId) => store.isTombstoned(sessionId),
    isRunning,
    platformSessionOf,
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

function hasSessionCapability(
  frame: unknown,
  name: "close" | "resume" | "fork",
): boolean {
  if (!isNonNullObject(frame)) return false;
  const result = frame.result;
  if (!isNonNullObject(result)) return false;
  const caps = result.agentCapabilities;
  if (!isNonNullObject(caps)) return false;
  const session = caps.sessionCapabilities;
  if (!isNonNullObject(session)) return false;
  return isNonNullObject(session[name]);
}

function steerOutcomeOf(frame: unknown): SteerOutcome {
  const parsed = steerResponseSchema.safeParse(
    (frame as { result?: unknown }).result,
  );
  return parsed.success && parsed.data.outcome === "injected"
    ? "injected"
    : "refused";
}

function queueableBlocks(prompt: unknown): PromptBlock[] {
  if (!Array.isArray(prompt)) return [];
  const blocks = prompt.flatMap((block) => {
    const parsed = promptBlockSchema.safeParse(block);
    return parsed.success ? [parsed.data] : [];
  });
  return capInlineImages(blocks).blocks;
}

function extractStopReason(frame: unknown): string | null {
  if (!isNonNullObject(frame)) return null;
  const result = frame.result;
  if (!isNonNullObject(result)) return null;
  const stopReason = result.stopReason;
  return typeof stopReason === "string" && stopReason.length > 0
    ? stopReason
    : null;
}

function extractTurnError(frame: unknown): PlatformTurnEndedParams["error"] {
  if (!isNonNullObject(frame)) return undefined;
  const error = frame.error;
  if (!isNonNullObject(error)) return undefined;
  const message =
    typeof error.message === "string" && error.message.length > 0
      ? capped(error.message)
      : "Internal error";
  const details = jsonRpcErrorDetails(error.data);
  return {
    message,
    ...(details !== undefined && { details: capped(details) }),
  };
}

function capped(text: string): string {
  return text.length > TURN_ERROR_TEXT_CAP
    ? `${text.slice(0, TURN_ERROR_TEXT_CAP)}…`
    : text;
}

const REPORTED_MODEL_META_KEY = "_claude/model";

function extractReportedModel(frame: unknown): string | null {
  if (!isNonNullObject(frame)) return null;
  if (frame.method !== "session/update") return null;
  const params = frame.params;
  if (!isNonNullObject(params)) return null;
  const update = params.update;
  if (!isNonNullObject(update) || !isNonNullObject(update._meta)) return null;
  const model = update._meta[REPORTED_MODEL_META_KEY];
  return typeof model === "string" && model !== "" && model !== "<synthetic>"
    ? model
    : null;
}

function sessionUpdateKind(frame: unknown): string | null {
  if (!isNonNullObject(frame) || frame.method !== "session/update") return null;
  const params = frame.params;
  if (!isNonNullObject(params) || !isNonNullObject(params.update)) return null;
  const kind = params.update.sessionUpdate;
  return typeof kind === "string" ? kind : null;
}

function extractAgentTextChunk(frame: unknown): string | null {
  if (!isNonNullObject(frame)) return null;
  if (frame.method !== "session/update") return null;
  const params = frame.params;
  if (!isNonNullObject(params)) return null;
  const update = params.update;
  if (!isNonNullObject(update)) return null;
  if (update.sessionUpdate !== "agent_message_chunk") return null;
  const content = update.content;
  if (!isNonNullObject(content) || content.type !== "text") return null;
  return typeof content.text === "string" ? content.text : null;
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
