import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import type { PendingRestart, Sender, Session } from "agent-runtime-api";
import {
  buildPlatformSenderRecordedNotification,
  buildPlatformTurnStartedNotification,
  buildPlatformVerdictRecordedNotification,
  stampedSenderOf,
  buildPlatformQueueChangedNotification,
  buildPlatformSessionResetNotification,
  buildPlatformRunEndedNotification,
  buildPlatformRunStartedNotification,
  capInlineImages,
  buildPlatformTurnEndedNotification,
  jsonRpcErrorDetails,
  platformContinuedFromSchema,
  platformRemoveQueuedParamsSchema,
  platformSteerQueuedParamsSchema,
  platformRewriteFromParamsSchema,
  platformUndeliveredPromptSchema,
  platformUpdateQueuedParamsSchema,
  PROMPT_NOT_QUEUED_CODE,
  PROMPT_NOT_QUEUED_MESSAGE,
  promptBlockSchema,
  REWRITE_BUSY_CODE,
  REWRITE_REFUSED_CODE,
  separateRendererBlocks,
  SessionType,
  STEER_METHOD,
  steerResponseSchema,
  steeringSupported,
  type PromptBlock,
  type PlatformContinuedFrom,
  type PlatformTurnEndedParams,
  type JsonRpcResponse,
  type PlatformRewriteFromParams,
  type PlatformUpdateQueuedParams,
  type PlatformUndeliveredPrompt,
} from "api-server-api";

import {
  toolCallOutcomeIn,
  type ArtifactTouch,
  type SubAgentSpawn,
} from "../../infrastructure/tool-call-outcome.js";
import {
  createToolActivityReader,
  type ToolActivity,
} from "../../../changes/index.js";
import {
  carriesContinuedFrom,
  frameContinuedFrom,
} from "../../domain/continued-from.js";
import { frameDirectTurn, isDirectSurface } from "../../domain/direct-turn.js";
import {
  isNonNullObject,
  isRequest,
  isResponse,
  paramsOf,
  parseFrame,
  resultOf,
  sessionUpdateOf,
  stringAt,
  type JsonRpcId,
} from "api-server-api";
import {
  harnessLostSession,
  rewriteAuthError,
  rewriteCwd,
  undeliveredOf,
} from "../../domain/mappers.js";
import {
  rewriteCutOf,
  takeBackCutOf,
  withOriginalTimes,
  type RewriteCut,
} from "../../domain/rewrite-cut.js";
import {
  composeSessionList,
  type ListedHarnessSession,
} from "../../domain/session-list.js";
import type { AgentProcess } from "../../infrastructure/agent-process.js";
import type { ClientChannel } from "../../infrastructure/client-channel.js";
import type { HistoryProvider } from "../../infrastructure/history-provider.js";
import type { SessionCutProvider } from "../../infrastructure/session-cut-provider.js";
import type { PlatformSessionOf } from "../../infrastructure/terminal-session-pins.js";
import {
  platformSessionMetaSchema,
  type PlatformSessionMeta,
  type SessionMetadataStore,
} from "../../infrastructure/session-metadata-store.js";
import type { RunResultStore } from "../../infrastructure/run-result-store.js";
import type { UndeliveredPromptStore } from "../../infrastructure/undelivered-prompt-store.js";
import type { ContinuedFromStore } from "../../infrastructure/continued-from-store.js";
import type { ActiveTurnStore } from "../../infrastructure/active-turn-store.js";
import type {
  BackgroundWorkRegistry,
  HeldSession,
} from "../background-work-registry.js";
import {
  createHarnessLease,
  type HarnessTeardownReason,
} from "./harness-lease.js";
import {
  createPendingAgentRequests,
  type AgentRequestObserver,
} from "./pending-agent-requests.js";
import { createAutonomousTurns } from "./autonomous-turns.js";
import { createHarnessActivity } from "./harness-activity.js";
import type { HarnessStatePort } from "../../domain/harness-state.js";
import {
  createPromptScheduler,
  type ModeRole,
  type PromptFate,
  type PromptSubmission,
  type SteerOutcome,
} from "./prompt-scheduler.js";
import { createSessionBootstrap } from "./session-bootstrap.js";
import { createSessionTranscript } from "./session-transcript.js";
import { MAX_RESUME_ATTEMPTS } from "../interrupted-turn-recovery.js";
import { platformOf, withPlatform } from "../../domain/platform-meta.js";
import { verdictOf, withoutAnsweredBy } from "../../domain/attribution.js";

const DEFAULT_ORPHAN_TTL_MS = 10 * 60 * 1000;

const DEFAULT_ENV_FORCE_RECYCLE_MS = 60 * 1000;
const CALL_DRAIN_MS = 10 * 1000;

const DEFAULT_WARM_START_TIMEOUT_MS = 15 * 1000;
const DEFAULT_SPAWN_WORK_TIMEOUT_MS = 5 * 1000;

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

const TAKE_BACK_HISTORY_ATTEMPTS = 8;
const TAKE_BACK_HISTORY_RETRY_MS = 250;

export interface AcpRuntimeStatus {
  idle: boolean;
  backgroundWork: HeldSession[];
}

export interface AcpRuntime {
  attach(
    channel: ClientChannel,
    opts?: { viewer?: boolean; marksSeen?: boolean },
  ): void;
  prestart(): void;
  status(): AcpRuntimeStatus;
  isSessionRunning(sessionId: string): boolean;
  toolCallsOpen(sessionId: string): boolean;
  harnessBusy(sessionId: string): boolean;
  sessionFrames(sessionId: string): { frames: string[]; truncated: boolean };
  resetSession(sessionId: string): void;
  markSessionCold(sessionId: string): void;
  releaseSession(sessionId: string): void;
  syncSessionSettings(sessionId: string): void;
  holdsSessions(): boolean;
  refreshEnv(opts: { force: boolean }): void;
  recycleForConfig(): void;
  harnesses(): RunningHarness[];
  pendingRestart(): PendingRestart | null;
  applyPendingRestart(): boolean;
  onPendingRestartChange(cb: () => void): void;
  shutdown(scope?: "process" | "lease"): void;
}

export interface RunningHarness {
  pid: number;
  turnSince: number | null;
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
  spawnWorkTimeoutMs?: number;
  beforeSpawn?: () => Promise<void>;
  onPrompt?: () => void;
  logBytesCap?: number;
  replayTailEvents?: number;
  harnessLoadTimeoutMs?: number;
  historyProvider?: HistoryProvider;
  sessionCut?: SessionCutProvider;
  terminalSessionPins?: () => PlatformSessionOf;
  sessionMetadata?: SessionMetadataStore;
  backgroundWork: BackgroundWorkRegistry;
  backgroundWorkRecheckMs?: number;
  harnessState?: HarnessStatePort;
  presumeIdleMs?: number;
  queueParkMs?: number;
  undeliveredPrompts: UndeliveredPromptStore;
  continuedFrom: ContinuedFromStore;
  activeTurns: ActiveTurnStore;
  runResults?: RunResultStore;
  sessionMcpServers?: (ref: string) => unknown[];
  onReportableTurnEnded?: (report: ReportableTurn) => void;
  isTerminalSessionActive?: (sessionId: string) => boolean;
  onArtifactTouch: (touch: ArtifactTouch) => void;
  onSubAgentSpawn?: (spawn: SubAgentSpawn) => void;
  onToolActivity?: (activity: ToolActivity) => void;
  agentRequests: AgentRequestObserver;
  onHarnessExited?: () => void;
  onTurnOutcome?: (
    sessionId: string,
    end: { stopReason: string | null; error: string | null },
  ) => void;
  onResultAccepted?: (sessionId: string) => void;
  sessionSettingFrames?: (sessionId: string) => SessionSettingFrame[];
  modelSettingConfig?: string;
  modeSettingId?: string;
}

export interface SessionSettingFrame {
  method: string;
  params: Record<string, unknown>;
  critical?: boolean;
}

export const SCHEDULE_SURFACE = "schedule";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the surface of a message another of the agent's
 * Sessions sent. Nobody waits on it, and it may join a turn in flight as a
 * typed message does.
 */
export const MESSAGE_SURFACE = "message";

export interface ReportableTurn {
  sessionId: string;
  reportTo: string;
  reportName: string;
  text: string;
  truncated: boolean;
}

type RewriteRequest = PlatformRewriteFromParams & { sender?: Sender };

interface OutboundMapping {
  channel: ClientChannel | null;
  originalId: JsonRpcId | null;
  method: string;
  promptSessionId: string | null;
  attachSessionId: string | null;
  platformMeta: PlatformSessionMeta | null;
  continuedFrom?: PlatformContinuedFrom;
  rehydrate?: boolean;
  settingSessionId?: string;
  critical?: boolean;
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
  const openToolCalls = new Map<string, Set<string>>();
  const generating = new Set<string>();
  const turnSenders = new Map<string, Sender>();
  let sessionForkSupported = false;
  const ownRequests = new Map<number, (frame: unknown) => void>();
  let initializeAnswer: { result?: unknown; error?: unknown } | null = null;
  let initializeWaiters: { channel: ClientChannel; id: unknown }[] | null =
    null;
  const engagedSessions = new Map<ClientChannel, Set<string>>();
  const nonViewerChannels = new Set<ClientChannel>();
  const unseeingChannels = new Set<ClientChannel>();
  const outboundIdToClient = new Map<number, OutboundMapping>();

  function mapOutbound(
    id: number,
    mapping: Partial<OutboundMapping> & { method: string },
  ): number {
    outboundIdToClient.set(id, {
      channel: null,
      originalId: null,
      promptSessionId: null,
      attachSessionId: null,
      platformMeta: null,
      ...mapping,
    });
    return id;
  }

  function submitPrompt(
    frame: unknown,
    submission: Omit<PromptSubmission, "frame">,
  ): PromptFate {
    const fate = promptScheduler.submit({ ...submission, frame });
    if (fate !== "refused") return fate;
    outboundIdToClient.delete(submission.outboundId);
    if (carriesContinuedFrom(frame))
      deps.continuedFrom.markUnsent(submission.sessionId);
    return fate;
  }
  let waitingAttaches = 0;

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
  let processExiting = false;
  let harnessGone: string | null = null;
  const teardownCause = (reason: HarnessTeardownReason): string | null => {
    if (reason === "shutdown") return null;
    if (reason !== "agent-exited") return teardownCloseByReason[reason].message;
    const cause = lease.lastExitCause();
    return cause ? `the harness exited (${cause})` : "the harness exited";
  };

  const autonomousTurns = createAutonomousTurns({
    onEnded: (sessionId, turnId) =>
      transcript.append(
        sessionId,
        JSON.stringify(
          buildPlatformTurnEndedNotification({ sessionId, turnId }),
        ),
      ),
  });

  const heldRuns = new Map<
    string,
    { promptId: string | null; stopReason: string | null; cancelled: boolean }
  >();

  const harnessActivity = createHarnessActivity({
    onBusy: (sessionId) => {
      if (!promptScheduler.hasTurnInFlight(sessionId))
        deps.activeTurns.record(sessionId);
    },
    onIdle: (sessionId) => {
      finishHeldRun(sessionId);
      if (!promptScheduler.hasTurnInFlight(sessionId))
        deps.activeTurns.remove(sessionId);
      maybeCloseIdleSession(sessionId);
      checkPendingRestart();
      lease.maybeRecycle();
    },
    mayPresumeIdle: (sessionId) =>
      !promptScheduler.hasTurnInFlight(sessionId) &&
      !pendingRequests.hasFor(sessionId) &&
      !deps.backgroundWork.hasWork(sessionId),
    ...(deps.presumeIdleMs !== undefined && {
      presumeIdleMs: deps.presumeIdleMs,
    }),
    log: (msg) => deps.log?.(msg),
  });

  function finishHeldRun(sessionId: string): void {
    const held = heldRuns.get(sessionId);
    if (held === undefined) return;
    heldRuns.delete(sessionId);
    finishRun(
      sessionId,
      held.promptId,
      held.cancelled ? "cancelled" : held.stopReason,
    );
  }

  function sendToHarness(frame: unknown): boolean {
    return lease.send(deps.harnessState?.request(frame) ?? frame);
  }

  function dropHarnessWork(sessionId: string): void {
    const held = heldRuns.get(sessionId);
    if (held) {
      heldRuns.delete(sessionId);
      recordRun(sessionId, held.promptId, null);
    }
    if (!harnessActivity.isBusy(sessionId)) return;
    harnessActivity.forget(sessionId);
    if (!promptScheduler.hasTurnInFlight(sessionId))
      deps.activeTurns.remove(sessionId);
  }

  const promptScheduler = createPromptScheduler({
    sendToAgent: (frame) => sendToHarness(frame),
    modeRoleOf: (entry) => entry.modeRole ?? null,
    onTurnStarted: ({
      sessionId,
      unattended,
      typed,
      channel,
      promptId,
      queuedAt,
      frame,
      sender,
    }) => {
      autonomousTurns.end(sessionId);
      finishHeldRun(sessionId);
      generating.add(sessionId);
      const echoId = promptId ?? randomUUID();
      appendUserPromptToLog(
        sessionId,
        typed,
        queuedAt === undefined ? channel : null,
        echoId,
      );
      announceTurnStart(sessionId, sender);
      if (sender !== undefined) recordSender(sessionId, echoId, sender);
      deps.activeTurns.record(
        sessionId,
        deps.sessionMetadata?.get(sessionId)?.unstored === true
          ? undeliveredOf(echoId, frame, new Date().toISOString())
          : undefined,
      );
      if (unattended === true) {
        const at = deps.sessionMetadata?.startRun(sessionId);
        if (at) announceRunStart(sessionId, at);
      }
      checkPendingRestart();
    },
    canSteer: () => harnessSteers,
    atSteerPoint: (sessionId) =>
      !generating.has(sessionId) && !(openToolCalls.get(sessionId)?.size ?? 0),
    steer: (entry) => steerIntoTurn(entry),
    onSteered: (
      {
        sessionId,
        typed,
        channel,
        promptId,
        outboundId,
        originalId,
        queuedAt,
        sender,
      },
      turnEnded,
    ) => {
      outboundIdToClient.delete(outboundId);
      const echoId = promptId ?? randomUUID();
      appendUserPromptToLog(
        sessionId,
        typed,
        queuedAt === undefined ? channel : null,
        echoId,
        { steered: true },
      );
      if (sender !== undefined) recordSender(sessionId, echoId, sender);
      if (turnEnded) answerSteered({ channel, originalId }, null);
    },
    onQueueChanged: (sessionId) => announceQueue(sessionId),
    onTurnEnded: (sessionId) => {
      turnSenders.delete(sessionId);
      if (shuttingDown) return;
      deps.sessionMetadata?.finishRun(sessionId);
      if (!harnessActivity.isBusy(sessionId))
        deps.activeTurns.remove(sessionId);
      checkPendingRestart();
    },
    onTurnInterrupted: (sessionId, turn) => {
      turnSenders.delete(sessionId);
      if (harnessGone)
        deps.onTurnOutcome?.(sessionId, {
          stopReason: null,
          error: `${harnessGone} mid-turn`,
        });
      const unstoredPrompt = processExiting
        ? undefined
        : deps.activeTurns.promptOf(sessionId);
      if (unstoredPrompt) {
        deps.undeliveredPrompts.remember(sessionId, [unstoredPrompt]);
        deps.continuedFrom.markUnsent(sessionId);
      }
      if (!turn.runPrompt && !isRunSession(sessionId)) return;
      recordRun(sessionId, turn.promptId, null);
    },
    canStart: ({ sessionId, unattended }) =>
      (unattended === true || hasEngagedChannel(sessionId)) &&
      !harnessColdSessions.has(sessionId),
    sessionLoaded: (sessionId) => !harnessColdSessions.has(sessionId),
    onQueueDropped(sessionId, dropped, cause) {
      const recordedAt = new Date().toISOString();
      if (dropped.some((entry) => carriesContinuedFrom(entry.frame)))
        deps.continuedFrom.markUnsent(sessionId);
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
      if (
        harnessGone ||
        (cause === "park-expired" &&
          !promptScheduler.hasTurnInFlight(sessionId))
      )
        deps.onTurnOutcome?.(sessionId, {
          stopReason: null,
          error: harnessGone
            ? `${harnessGone} before it took the prompt`
            : "the prompt was never taken: the harness did not start the turn",
        });
      if (cause !== "park-expired") return;
      maybeCloseIdleSession(sessionId);
      lease.maybeRecycle();
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
      sendToHarness(frame);
    },
    onExpired() {
      lease.maybeRecycle();
    },
    observer: deps.agentRequests,
  });

  let nextOutboundId = 1;

  const toolActivityIn = createToolActivityReader();
  const bootstrap = createSessionBootstrap({
    transcript,
    turnInFlight(sessionId) {
      return promptScheduler.hasTurnInFlight(sessionId);
    },
    interruption(sessionId) {
      if (promptScheduler.hasTurnInFlight(sessionId)) return undefined;
      return deps.activeTurns
        .leftovers()
        .find((m) => m.sessionId === sessionId);
    },
    undeliveredFor(sessionId) {
      return deps.undeliveredPrompts.readFor(sessionId);
    },
    settleUnstored(sessionId) {
      if (deps.sessionMetadata?.get(sessionId)?.unstored !== true) return null;
      if (promptScheduler.hasWork(sessionId)) return null;
      const cut = deps.activeTurns
        .leftovers()
        .find((m) => m.sessionId === sessionId);
      if (cut?.prompt)
        deps.undeliveredPrompts.remember(sessionId, [cut.prompt]);
      if (cut) deps.activeTurns.remove(sessionId);
      const undelivered = deps.undeliveredPrompts.readFor(sessionId);
      if (undelivered.length === 0) retireSession(sessionId);
      return undelivered;
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
    attributionOf(sessionId) {
      return {
        senders: deps.sessionMetadata?.sendersOf(sessionId) ?? [],
        verdicts: deps.sessionMetadata?.verdictsOf(sessionId) ?? [],
      };
    },
    turnSenderOf(sessionId) {
      return turnSenders.get(sessionId);
    },
    continuedFromOf(sessionId) {
      return deps.continuedFrom.readFor(sessionId);
    },
    engage(channel, sessionId) {
      engage(channel, sessionId);
    },
    openLoadRoute(sessionId) {
      return mapOutbound(nextOutboundId++, {
        method: "session/load",
        attachSessionId: sessionId,
      });
    },
    sendToAgent(frame) {
      sendToHarness(frame);
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
  const appliedSettings = new Map<string, Map<string, string>>();
  const settingsChannel: ClientChannel = {
    send() {},
    close() {},
    isOpen: () => true,
    onMessage() {},
    onClose() {},
  };
  const turnModels = new Map<string, string>();
  const runTextBuffers = new Map<
    string,
    { text: string; truncated: boolean }
  >();

  function isRunSession(sessionId: string): boolean {
    const meta = deps.sessionMetadata?.get(sessionId)?.meta;
    return meta?.type === SessionType.CliRun || meta?.reportTo !== undefined;
  }

  const unconfirmedRefs = new Map<string, string>();

  function refFor(sessionId: string): string {
    const entry = deps.sessionMetadata?.get(sessionId);
    if (entry?.meta.ref) return entry.meta.ref;
    if (entry) {
      const ref = randomUUID();
      deps.sessionMetadata?.set(sessionId, { ...entry.meta, ref });
      return ref;
    }
    const ref = unconfirmedRefs.get(sessionId) ?? randomUUID();
    unconfirmedRefs.set(sessionId, ref);
    return ref;
  }

  function settleUnconfirmedRef(sessionId: string, attached: boolean): void {
    const ref = unconfirmedRefs.get(sessionId);
    if (ref === undefined) return;
    unconfirmedRefs.delete(sessionId);
    if (!attached || !deps.sessionMetadata) return;
    const current = deps.sessionMetadata.get(sessionId)?.meta;
    deps.sessionMetadata.set(sessionId, { ...current, ref });
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

  function recordRun(
    sessionId: string,
    promptId: string | null,
    stopReason: string | null,
  ): { text: string; truncated: boolean } | undefined {
    const buffer = runTextBuffers.get(sessionId);
    runTextBuffers.delete(sessionId);
    deps.runResults?.record(sessionId, {
      promptId,
      stopReason,
      finalText: buffer?.text ?? "",
      truncated: buffer?.truncated ?? false,
      endedAt: new Date().toISOString(),
    });
    return buffer;
  }

  function finishRun(
    sessionId: string,
    promptId: string | null,
    stopReason: string | null,
  ): void {
    reportTurnEnd(sessionId, recordRun(sessionId, promptId, stopReason));
    transcript.append(
      sessionId,
      JSON.stringify(
        buildPlatformRunEndedNotification({
          sessionId,
          ...(promptId !== null && { promptId }),
          ...(stopReason !== null && { stopReason }),
        }),
      ),
    );
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
  const rewritingSessions = new Set<string>();
  const cuttingSessions = new Set<string>();

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
    if (cuttingSessions.has(sessionId)) return;
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
    rehydrateLoadIds.set(sessionId, nextOutboundId);
    const method = sessionResumeSupported ? "session/resume" : "session/load";
    const outboundId = mapOutbound(nextOutboundId++, {
      method,
      attachSessionId: sessionId,
      rehydrate: true,
    });
    sendToHarness(
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
      appliedSettings.delete(sessionId);
      syncSettings(sessionId);
      promptScheduler.onSessionReady(sessionId);
      return;
    }
    promptScheduler.refuseQueue(sessionId, rehydrateFailureMessage(error));
  }

  /**
   * UNIT_BOUNDARY_DESCRIPTION: a harness may refuse a model name it has not
   * listed yet (Claude Code lists the router's catalog lazily), so a critical
   * setting is sent once more after a short wait; a second refusal answers
   * the queued prompts with the harness's own reason rather than running
   * them on a substitute. The refused value is forgotten, so the next prompt
   * asks again until the model changes.
   */
  const criticalRetries = new Map<string, number>();
  const CRITICAL_RETRY_MS = 2_000;
  function retryCriticalSetting(
    sessionId: string,
    mapping: OutboundMapping,
    outboundId: number,
    error: { message?: unknown; data?: unknown },
  ): boolean {
    const key = `${sessionId}:${mapping.method}`;
    const tried = criticalRetries.get(key) ?? 0;
    if (tried < 1) {
      criticalRetries.set(key, tried + 1);
      const timer = setTimeout(() => {
        const applied = appliedSettings.get(sessionId);
        for (const [k] of applied ?? [])
          if (k.startsWith(mapping.method)) applied?.delete(k);
        syncSettings(sessionId, true);
        promptScheduler.onSettingResponse(sessionId, outboundId);
      }, CRITICAL_RETRY_MS);
      timer.unref?.();
      return true;
    }
    criticalRetries.delete(key);
    const applied = appliedSettings.get(sessionId);
    for (const [k] of applied ?? [])
      if (k.startsWith(mapping.method)) applied?.delete(k);
    const details =
      error.data !== null &&
      typeof error.data === "object" &&
      typeof (error.data as { details?: unknown }).details === "string"
        ? (error.data as { details: string }).details
        : null;
    promptScheduler.refuseQueue(
      sessionId,
      `The harness refused the session's model: ${details ?? String(error.message ?? "unknown error")}`,
    );
    return false;
  }

  /**
   * UNIT_BOUNDARY_DESCRIPTION: whether a mode the harness reports is the answer
   * to work the runtime still owes rather than the session taking a mode. Only
   * sent work can have caused a report, and only work the runtime reconciles
   * makes the report its own — a derived mode, or a model whose answer carries a
   * reconciled mode. A mode someone chose and has not sent yet is newer than the
   * report, so it is not saved over either. A frame that has not reached the
   * harness cannot have caused anything: two settings that name the same mode
   * are not the same event.
   */
  function modeReportIsRuntimeWork(sessionId: string): boolean {
    return promptScheduler.modeWork(sessionId).some((work) => {
      if (work.sent) return work.role === "reconcile";
      return work.role === "owner";
    });
  }

  /**
   * UNIT_BOUNDARY_DESCRIPTION: a mode the session took while the runtime still
   * had a mode queued behind its turn makes that frame obsolete: it was sent
   * before the session held this mode, and sending it would undo the mode once
   * the turn ends. Only a mode the runtime reconciles is dropped, never one the
   * owner chose; the queued model change stays, since the owner asked for it and
   * the mode survives it. A dropped frame's answer mapping goes with it, so an
   * unsent frame cannot hold the process open.
   */
  function dropQueuedModeWork(sessionId: string): void {
    const dropped = promptScheduler.dropQueuedSettings(
      sessionId,
      (entry) =>
        entry.modeRole === "reconcile" &&
        (entry.frame as { method?: unknown }).method === "session/set_mode",
    );
    for (const entry of dropped) {
      appliedSettings
        .get(sessionId)
        ?.delete(settingKeyOf(entry.frame as SessionSettingFrame));
      outboundIdToClient.delete(entry.outboundId);
    }
  }

  function syncSettings(sessionId: string, first = false): void {
    if (harnessColdSessions.has(sessionId)) return;
    const applied = appliedSettings.get(sessionId) ?? new Map<string, string>();
    appliedSettings.set(sessionId, applied);
    const block: PromptSubmission[] = [];
    const chosenMode =
      deps.sessionMetadata?.get(sessionId)?.meta.settings?.[
        deps.modeSettingId ?? ""
      ];
    for (const frame of deps.sessionSettingFrames?.(sessionId) ?? []) {
      const { method, params } = frame;
      const key = settingKeyOf(frame);
      const value = JSON.stringify(params);
      if (applied.get(key) === value) continue;
      applied.set(key, value);
      const role = modeRoleOfFrame(
        { method, params },
        deps.modelSettingConfig,
        deps.modeSettingId,
        chosenMode,
        false,
      );
      const outboundId = mapOutbound(nextOutboundId++, {
        channel: settingsChannel,
        method,
        settingSessionId: sessionId,
        ...(frame.critical && { critical: true }),
      });
      block.push({
        sessionId,
        channel: settingsChannel,
        outboundId,
        originalId: outboundId,
        frame: { jsonrpc: "2.0", id: outboundId, method, params },
        promptId: null,
        unattended: true,
        modeRole: role ?? undefined,
      });
    }
    promptScheduler.submitSettings(block, first);
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
    const unanswered = [
      ...unansweredCalls().map((m) => ({
        channel: m.channel,
        id: m.originalId,
      })),
      ...(initializeWaiters ?? []),
    ];
    for (const { channel, id } of unanswered) {
      if (!channel) continue;
      sendToChannel(
        channel,
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32000,
            message:
              reason === "agent-exited"
                ? (teardownCause(reason) ?? close.message)
                : close.message,
          },
        }),
      );
    }
    outboundIdToClient.clear();
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
    harnessGone = teardownCause(reason);
    if (!shuttingDown)
      for (const sessionId of new Set([
        ...heldRuns.keys(),
        ...harnessActivity.busySessions(),
      ])) {
        if (harnessGone && !promptScheduler.hasTurnInFlight(sessionId))
          deps.onTurnOutcome?.(sessionId, {
            stopReason: null,
            error: `${harnessGone} in its Autonomous Turn`,
          });
        dropHarnessWork(sessionId);
      }
    heldRuns.clear();
    harnessActivity.clear();
    promptScheduler.clear();
    autonomousTurns.clear();
    runTextBuffers.clear();
    openToolCalls.clear();
    generating.clear();
    turnModels.clear();
    harnessColdSessions.clear();
    appliedSettings.clear();
    rehydratingSessions.clear();
    harnessGone = null;
    sessionCloseSupported = true;
    sessionResumeSupported = false;
    harnessSteers = false;
    sessionForkSupported = false;
    const unansweredOwn = [...ownRequests.values()];
    ownRequests.clear();
    for (const reply of unansweredOwn)
      reply({
        error: {
          code: -32000,
          message: teardownCause(reason) ?? "the harness went down",
        },
      });
    initializeAnswer = null;
    initializeWaiters = null;
    deps.backgroundWork.clear();
    if (reason === "agent-exited") deps.onHarnessExited?.();
  }

  function unansweredCalls(): OutboundMapping[] {
    return [...outboundIdToClient.values()].filter(
      (m) => m.promptSessionId === null && m.originalId !== null,
    );
  }

  function describeBusy(): string {
    return (
      `${promptScheduler.activeTurnCount()} turn(s), ` +
      `${pendingRequests.size()} pending request(s), ` +
      `${unansweredCalls().length} call(s) in flight, ` +
      `${harnessActivity.busySessions().length} harness turn(s) after a prompt, ` +
      `${deps.backgroundWork.held().length} background hold(s)`
    );
  }

  function taskCount(sessions: HeldSession[]): number {
    return sessions.reduce((n, held) => n + held.items.length, 0);
  }

  function keptTaskCount(): number {
    return taskCount(deps.backgroundWork.held());
  }

  const pendingRestartListeners: (() => void)[] = [];
  let lastPendingRestart = "null";

  function pendingRestart(): PendingRestart | null {
    const pending = lease.pending();
    const blockingTasks = keptTaskCount();
    if (!pending || blockingTasks === 0) return null;
    return {
      reason: pending.reason,
      since: new Date(pending.since).toISOString(),
      blockingTasks,
      stops: {
        tasks: taskCount(deps.backgroundWork.reported()),
        turns: promptScheduler.activeTurnCount(),
      },
    };
  }

  function checkPendingRestart(): void {
    const next = JSON.stringify(pendingRestart());
    if (next === lastPendingRestart) return;
    lastPendingRestart = next;
    for (const cb of pendingRestartListeners) cb();
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
    spawnWorkTimeoutMs:
      deps.spawnWorkTimeoutMs ?? DEFAULT_SPAWN_WORK_TIMEOUT_MS,
    envForceRecycleMs,
    keptTasks: keptTaskCount,
    callsInFlight: () => unansweredCalls().length,
    callDrainMs: CALL_DRAIN_MS,
    onPendingChange: () => checkPendingRestart(),
    ...(deps.beforeSpawn ? { beforeSpawn: deps.beforeSpawn } : {}),
    log(msg) {
      deps.log?.(msg);
    },
  });

  function engage(channel: ClientChannel, sessionId: string): void {
    const sessions = engagedSessions.get(channel);
    if (!sessions) return;
    if (sessions.has(sessionId)) return;
    sessions.add(sessionId);
    if (!nonViewerChannels.has(channel) && !unseeingChannels.has(channel))
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

  function announceTurnStart(sessionId: string, sender?: Sender): void {
    if (sender === undefined) turnSenders.delete(sessionId);
    else turnSenders.set(sessionId, sender);
    const line = JSON.stringify(
      buildPlatformTurnStartedNotification({
        sessionId,
        ...(sender !== undefined && { sender }),
      }),
    );
    for (const channel of engagedViewersOf(sessionId)) channel.send(line);
  }

  function recordSender(
    sessionId: string,
    promptId: string,
    sender: Sender,
  ): void {
    const entry = { at: new Date().toISOString(), promptId, sender };
    deps.sessionMetadata?.recordSender(sessionId, entry);
    const line = JSON.stringify(
      buildPlatformSenderRecordedNotification({ sessionId, entry }),
    );
    for (const channel of engagedViewersOf(sessionId)) channel.send(line);
  }

  function recordVerdict(
    answered: { sessionId: string | null; line: string },
    frame: JsonRpcResponse,
  ): void {
    const by = stampedSenderOf(frame.result, "answeredBy");
    if (by === null || answered.sessionId === null) return;
    const verdict = verdictOf(answered.line, frame.result, by);
    if (verdict === null) return;
    const sessionId = answered.sessionId;
    deps.sessionMetadata?.recordVerdict(sessionId, verdict);
    const line = JSON.stringify(
      buildPlatformVerdictRecordedNotification({ sessionId, verdict }),
    );
    for (const channel of engagedViewersOf(sessionId)) channel.send(line);
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
    carryContinuedFrom = false,
  ): object {
    const forward = stripPlatformMeta(source);
    const framed =
      isDirectSurface(platformString(source, "surface")) &&
      deps.sessionMetadata?.get(sessionId)?.meta.threadTs !== undefined
        ? frameDirectTurn(forward)
        : forward;
    const seed = carryContinuedFrom
      ? deps.continuedFrom.readFor(sessionId)
      : deps.continuedFrom.takeUnsent(sessionId);
    const seeded = seed ? frameContinuedFrom(framed, seed) : framed;
    return rewriteCwd({ ...seeded, id: outboundId }, deps.workingDir);
  }

  function updateQueuedPrompt(
    sessionId: string,
    { promptId, prompt }: PlatformUpdateQueuedParams,
    sender: Sender | null,
  ): boolean {
    return promptScheduler.update(sessionId, promptId, (entry) => {
      const source = isNonNullObject(entry.source) ? entry.source : {};
      const params = isNonNullObject(source.params) ? source.params : {};
      const edited = { ...source, params: { ...params, prompt } };
      return {
        source: edited,
        frame: promptFrameFor(
          edited,
          sessionId,
          entry.outboundId,
          carriesContinuedFrom(entry.frame),
        ),
        typed: prompt,
        blocks: queueableBlocks(prompt),
        sender: sender ?? entry.sender,
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

  function trackSteerPoint(sessionId: string, frame: unknown): void {
    if (isAgentOutputChunk(frame)) {
      generating.add(sessionId);
      return;
    }
    const call = toolCallStateOf(frame);
    if (call === null) return;
    const open = openToolCalls.get(sessionId) ?? new Set<string>();
    if (call.started) generating.delete(sessionId);
    if (!call.settled) {
      open.add(call.toolCallId);
      openToolCalls.set(sessionId, open);
      return;
    }
    if (!open.delete(call.toolCallId) && !call.started) return;
    if (open.size > 0) return;
    openToolCalls.delete(sessionId);
    promptScheduler.onSteerPoint(sessionId);
  }

  function requestFromHarness(
    method: string,
    params: Record<string, unknown>,
    onReply: (frame: unknown) => void,
  ): void {
    const outboundId = nextOutboundId++;
    ownRequests.set(outboundId, onReply);
    if (
      sendToHarness(
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
        (frame) => {
          const outcome = steerOutcomeOf(frame);
          if (outcome === "injected") generating.add(entry.sessionId);
          resolve(outcome);
        },
      );
    });
  }

  function rewriteRefusal(
    sessionId: string,
  ): { message: string; code: string } | null {
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
      return {
        message: "only a chat session can be rewritten",
        code: REWRITE_REFUSED_CODE,
      };
    if (
      rewritingSessions.has(sessionId) ||
      promptScheduler.hasWork(sessionId) ||
      pendingRequests.hasFor(sessionId) ||
      bootstrap.has(sessionId)
    )
      return {
        message: "the session is busy; wait until the agent is idle",
        code: REWRITE_BUSY_CODE,
      };
    return null;
  }

  function retireSession(sessionId: string): void {
    deps.sessionMetadata?.tombstone(sessionId);
    deps.undeliveredPrompts.forgetSession(sessionId);
    deps.continuedFrom.forgetSession(sessionId);
    deps.activeTurns.remove(sessionId);
    deps.runResults?.forgetSession(sessionId);
    heldRuns.delete(sessionId);
    supersededEchoes.delete(sessionId);
  }

  function rewriteFrom(
    channel: ClientChannel,
    id: unknown,
    params: RewriteRequest,
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
    const refusal = rewriteRefusal(oldId);
    if (refusal !== null) {
      fail(refusal.message, refusal.code);
      return;
    }
    rewritingSessions.add(oldId);
    const failRewrite = (message: string, code?: string): void => {
      rewritingSessions.delete(oldId);
      fail(message, code);
    };
    void rewriteCutFor(oldId, params).then(({ cut, history }) => {
      if (cut.kind === "absent") {
        rewritingSessions.delete(oldId);
        sendToChannel(
          channel,
          JSON.stringify({ jsonrpc: "2.0", id, result: { sessionId: oldId } }),
        );
        return;
      }
      if (cut.kind === "missing") {
        failRewrite(
          params.prompt === undefined
            ? "the agent already answered this message"
            : "this message is not in the agent's own history, so the conversation cannot be cut there",
          REWRITE_REFUSED_CODE,
        );
        return;
      }
      if (
        cut.kind === "after" &&
        cut.batch !== undefined &&
        params.mode === "rewind" &&
        deps.sessionCut !== undefined
      ) {
        cutInPlace(
          channel,
          id,
          params,
          { ...cut, batch: cut.batch },
          history,
          deps.sessionCut,
          fail,
        );
        return;
      }
      if (cut.kind === "after" && !sessionForkSupported) {
        failRewrite(
          "this agent cannot rewrite a conversation",
          REWRITE_REFUSED_CODE,
        );
        return;
      }
      forkForRewrite(channel, id, params, cut, history, failRewrite);
    });
  }

  async function rewriteCutFor(
    sessionId: string,
    params: PlatformRewriteFromParams,
  ): Promise<{ cut: RewriteCut; history: string[] | null }> {
    for (let attempt = 1; ; attempt++) {
      const found = await resolveRewriteCut(sessionId, params);
      if (
        found.cut.kind !== "absent" ||
        params.prompt !== undefined ||
        attempt >= TAKE_BACK_HISTORY_ATTEMPTS
      )
        return found;
      await new Promise((r) => setTimeout(r, TAKE_BACK_HISTORY_RETRY_MS));
    }
  }

  async function resolveRewriteCut(
    sessionId: string,
    params: PlatformRewriteFromParams,
  ): Promise<{ cut: RewriteCut; history: string[] | null }> {
    const history =
      (await deps.historyProvider?.fetch(sessionId).catch(() => null)) ?? null;
    const resolved =
      history === null
        ? null
        : params.prompt === undefined
          ? takeBackCutOf(
              history,
              transcript.lines(sessionId).frames,
              params.messageId,
            )
          : rewriteCutOf(
              history,
              transcript.lines(sessionId).frames,
              params.messageId,
            );
    if (resolved !== null) return { cut: resolved, history };
    if (params.upToMessageId === undefined)
      return { cut: { kind: "missing" }, history: null };
    return {
      cut:
        params.upToMessageId === null
          ? { kind: "start" }
          : { kind: "after", entry: params.upToMessageId },
      history: null,
    };
  }

  function forkForRewrite(
    channel: ClientChannel,
    id: unknown,
    params: RewriteRequest,
    cut: Exclude<RewriteCut, { kind: "missing" } | { kind: "absent" }>,
    history: string[] | null,
    fail: (message: string, code?: string) => void,
  ): void {
    const oldId = params.sessionId;
    const fresh = cut.kind === "start";
    const ref = params.mode === "rewind" ? refFor(oldId) : randomUUID();
    requestFromHarness(
      fresh ? "session/new" : "session/fork",
      {
        ...(fresh ? {} : { sessionId: oldId }),
        cwd: ".",
        mcpServers: deps.sessionMcpServers?.(ref) ?? [],
        ...(!fresh && {
          _meta: {
            jetbrains: {
              air: {
                fork: {
                  version: 1,
                  messageId: cut.kind === "after" ? cut.entry : null,
                },
              },
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
        const adjustLines =
          history === null
            ? undefined
            : (lines: string[]) => withOriginalTimes(lines, history);
        bootstrap.fill(
          newId,
          (loaded) => {
            if (!loaded) {
              fail("the rewritten session could not be loaded");
              return;
            }
            rewritingSessions.delete(oldId);
            const meta = {
              ...(deps.sessionMetadata?.get(oldId)?.meta ?? {}),
              ref,
              ...(params.title !== undefined && { customTitle: params.title }),
            };
            deps.continuedFrom.copy(oldId, newId, !fresh);
            if (params.mode === "rewind") {
              deps.sessionMetadata?.adopt(newId, oldId, meta);
              deps.sessionMetadata?.copyAttribution(newId, oldId, {
                starter: true,
              });
              retireSession(oldId);
              tearDownSession(oldId);
            } else {
              deps.sessionMetadata?.set(newId, meta);
              deps.sessionMetadata?.copyAttribution(newId, oldId, {
                starter: false,
              });
            }
            sendToChannel(
              channel,
              JSON.stringify({
                jsonrpc: "2.0",
                id,
                result: { sessionId: newId },
              }),
            );
            if (params.prompt !== undefined && params.promptId !== undefined)
              submitRewrittenPrompt(
                channel,
                newId,
                params.prompt,
                params.promptId,
                params.sender,
              );
          },
          adjustLines,
        );
      },
    );
  }

  function cutInPlace(
    channel: ClientChannel,
    id: unknown,
    params: RewriteRequest,
    cut: { kind: "after"; entry: string; batch: string },
    history: string[] | null,
    sessionCut: SessionCutProvider,
    fail: (message: string, code?: string) => void,
  ): void {
    const sid = params.sessionId;
    const failRewrite = (message: string, code?: string): void => {
      rewritingSessions.delete(sid);
      fail(message, code);
    };
    const viewers = [...engagedViewersOf(sid)];
    const finish = (error?: string): void => {
      resetSession(sid, viewers, (loaded) => {
        endCut(sid);
        if (error !== undefined || !loaded) {
          failRewrite(error ?? "the rewound session could not be loaded");
          return;
        }
        rewritingSessions.delete(sid);
        if (params.title !== undefined) {
          const meta = deps.sessionMetadata?.get(sid)?.meta ?? {};
          deps.sessionMetadata?.set(sid, {
            ...meta,
            customTitle: params.title,
          });
        }
        sendToChannel(
          channel,
          JSON.stringify({ jsonrpc: "2.0", id, result: { sessionId: sid } }),
        );
        if (params.prompt !== undefined && params.promptId !== undefined)
          submitRewrittenPrompt(
            channel,
            sid,
            params.prompt,
            params.promptId,
            params.sender,
          );
      });
    };
    closeInHarness(sid, (closed) => {
      if (!closed) {
        if (sessionForkSupported)
          forkForRewrite(channel, id, params, cut, history, failRewrite);
        else
          failRewrite(
            "this agent cannot rewrite a conversation",
            REWRITE_REFUSED_CODE,
          );
        return;
      }
      cuttingSessions.add(sid);
      void sessionCut
        .cut({
          sessionId: sid,
          before: cut.batch,
          ...(params.prompt === undefined && { dropsTurn: cut.batch }),
        })
        .then((outcome) => {
          if (outcome.ok) {
            finish();
            return;
          }
          if (outcome.refused) {
            endCut(sid);
            failRewrite(outcome.message, REWRITE_REFUSED_CODE);
            return;
          }
          finish(outcome.message);
        });
    });
  }

  function endCut(sessionId: string): void {
    cuttingSessions.delete(sessionId);
    if (
      harnessColdSessions.has(sessionId) &&
      !rehydratingSessions.has(sessionId) &&
      promptScheduler.hasWork(sessionId)
    )
      startHarnessRehydrate(sessionId);
  }

  function closeInHarness(
    sessionId: string,
    done: (closed: boolean) => void,
  ): void {
    if (harnessColdSessions.has(sessionId)) {
      done(true);
      return;
    }
    if (!sessionCloseSupported) {
      done(false);
      return;
    }
    requestFromHarness("session/close", { sessionId }, (frame) => {
      const failed = (frame as { error?: unknown }).error !== undefined;
      if (!failed) harnessColdSessions.add(sessionId);
      done(!failed);
    });
  }

  /**
   * UNIT_BOUNDARY_DESCRIPTION: A Session Reset: after the harness's stored
   * conversation was cut in place, drops the Session's log and what the
   * runtime derived from it, keeping its id, metadata, queue and engaged
   * channels, and fills the log again from history. The viewers engaged
   * before the reset then get one ephemeral platform/sessionReset and load the
   * Session again; their cursors went with the old log, and a viewer's next
   * frame is the next live one. The harness copy stays closed, so the next
   * prompt rehydrates it from the cut store.
   */
  function resetSession(
    sessionId: string,
    viewers: readonly ClientChannel[],
    done: (loaded: boolean) => void,
  ): void {
    harnessColdSessions.add(sessionId);
    appliedSettings.delete(sessionId);
    autonomousTurns.end(sessionId);
    transcript.forget(sessionId);
    openToolCalls.delete(sessionId);
    generating.delete(sessionId);
    supersededEchoes.delete(sessionId);
    runTextBuffers.delete(sessionId);
    bootstrap.fill(sessionId, (loaded) => {
      const line = JSON.stringify(
        buildPlatformSessionResetNotification({ sessionId }),
      );
      for (const viewer of viewers) if (viewer.isOpen()) viewer.send(line);
      done(loaded);
    });
  }

  function submitRewrittenPrompt(
    channel: ClientChannel,
    sessionId: string,
    prompt: PromptBlock[],
    promptId: string,
    sender: Sender | undefined,
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
    mapOutbound(outboundId, {
      channel,
      method: "session/prompt",
      promptSessionId: sessionId,
    });
    deps.sessionMetadata?.recordActivity(sessionId);
    const fate = submitPrompt(promptFrameFor(source, sessionId, outboundId), {
      sessionId,
      channel,
      outboundId,
      originalId: null,
      promptId,
      source,
      typed: prompt,
      blocks: queueableBlocks(prompt),
      editable: false,
      steerable: true,
      ...(sender !== undefined && { sender }),
    });
    if (fate === "refused") return;
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

  function hasSeeingViewer(sessionId: string): boolean {
    for (const channel of engagedViewersOf(sessionId))
      if (!unseeingChannels.has(channel)) return true;
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
    if (harnessActivity.busySessions().length > 0) return true;
    return deps.backgroundWork.held().length > 0;
  }

  deps.backgroundWork.onChange(() => {
    checkPendingRestart();
    lease.maybeRecycle();
  });

  function detach(channel: ClientChannel): void {
    const sessions = engagedSessions.get(channel);
    engagedSessions.delete(channel);
    nonViewerChannels.delete(channel);
    unseeingChannels.delete(channel);
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
    lease.maybeRecycle();
  }

  function tearDownSession(sessionId: string): void {
    if (sessionCloseSupported && !harnessColdSessions.has(sessionId)) {
      sendToHarness({
        jsonrpc: "2.0",
        id: nextOutboundId++,
        method: "session/close",
        params: { sessionId },
      });
    }
    harnessColdSessions.delete(sessionId);
    appliedSettings.delete(sessionId);
    rehydratingSessions.delete(sessionId);
    const rehydrateTimer = rehydrateTimers.get(sessionId);
    if (rehydrateTimer) clearTimeout(rehydrateTimer);
    rehydrateTimers.delete(sessionId);
    rehydrateLoadIds.delete(sessionId);
    autonomousTurns.end(sessionId);
    transcript.forget(sessionId);
    openToolCalls.delete(sessionId);
    generating.delete(sessionId);
    supersededEchoes.delete(sessionId);
    dropHarnessWork(sessionId);
    promptScheduler.forget(sessionId);
    runTextBuffers.delete(sessionId);
    pendingRequests.forget(sessionId);
    deps.backgroundWork.forget(sessionId);
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
    if (harnessActivity.isBusy(sessionId)) return;
    if (deps.backgroundWork.hasWork(sessionId)) {
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
            mapping.continuedFrom !== undefined
          )
            deps.continuedFrom.save(sidFromResult, mapping.continuedFrom);
          if (
            mapping.method === "session/new" &&
            sidFromResult &&
            deps.sessionMetadata
          ) {
            deps.sessionMetadata.set(sidFromResult, mapping.platformMeta ?? {});
            deps.sessionMetadata.markUnstored(sidFromResult);
            syncSettings(sidFromResult);
          }
        }

        if (mapping.settingSessionId !== undefined) {
          const error = (
            frame as { error?: { message?: unknown; data?: unknown } }
          ).error;
          if (error !== undefined && mapping.channel === settingsChannel)
            deps.log?.(
              `session setting ${mapping.method} for ${mapping.settingSessionId} refused: ${String(error.message)}`,
            );
          if (error === undefined && mapping.critical === true)
            criticalRetries.delete(
              `${mapping.settingSessionId}:${mapping.method}`,
            );
          const deferred =
            error !== undefined &&
            mapping.critical === true &&
            retryCriticalSetting(
              mapping.settingSessionId,
              mapping,
              outboundId,
              error,
            );
          if (!deferred)
            promptScheduler.onSettingResponse(
              mapping.settingSessionId,
              outboundId,
            );
        }

        if (mapping.attachSessionId) {
          settleUnconfirmedRef(
            mapping.attachSessionId,
            (frame as { error?: unknown }).error === undefined,
          );
          if (mapping.rehydrate) {
            finishHarnessRehydrate(mapping.attachSessionId, frame);
          } else if (mapping.method === "session/load") {
            bootstrap.onLoadResponse(mapping.attachSessionId, frame);
          }
          if (
            !mapping.rehydrate &&
            (mapping.method === "session/load" ||
              mapping.method === "session/resume") &&
            (frame as { error?: unknown }).error === undefined
          ) {
            appliedSettings.delete(mapping.attachSessionId);
            syncSettings(mapping.attachSessionId);
          }
        }

        if (
          mapping.channel &&
          mapping.channel !== settingsChannel &&
          mapping.originalId !== null
        ) {
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
          if (turnEnded) {
            openToolCalls.delete(sid);
            generating.delete(sid);
            deps.sessionMetadata?.markStored(sid);
          }
          for (const follower of steered)
            answerSteered(follower, extractStopReason(frame));
          if (
            lost &&
            promptScheduler.hasWork(sid) &&
            !rehydratingSessions.has(sid)
          )
            startHarnessRehydrate(sid);
          deps.sessionMetadata?.recordActivity(sid);
          if (hasSeeingViewer(sid)) deps.sessionMetadata?.recordSeen(sid);
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
            if (harnessActivity.isBusy(sid))
              heldRuns.set(sid, { promptId, stopReason, cancelled: false });
            else finishRun(sid, promptId, stopReason);
          }
          if (turnEnded && (!lost || !promptScheduler.hasWork(sid)))
            deps.onTurnOutcome?.(sid, {
              stopReason,
              error:
                error === undefined
                  ? lost
                    ? "the harness lost the session"
                    : null
                  : [
                      ...(lost ? ["the harness lost the session"] : []),
                      error.message,
                      error.details,
                    ]
                      .filter(Boolean)
                      .join(": "),
            });
          maybeCloseIdleSession(sid);
        }
        lease.maybeRecycle();
      }
      return;
    }

    const sessionId = extractParamsSessionId(frame);
    if (sessionId) {
      const state = deps.harnessState?.read(frame);
      if (state) {
        harnessActivity.report(state.sessionId, state.busy);
        return;
      }
      if (
        orphanedHarnessLoads.has(sessionId) ||
        rehydratingSessions.has(sessionId) ||
        isNoResponseFiller(frame)
      ) {
        return;
      }
      const outcome = toolCallOutcomeIn(frame);
      if (outcome?.accepted) deps.onResultAccepted?.(outcome.sessionId);
      if (!bootstrap.has(sessionId)) {
        if (outcome?.artifactTouch) deps.onArtifactTouch(outcome.artifactTouch);
        if (outcome?.subAgentSpawn)
          deps.onSubAgentSpawn?.(outcome.subAgentSpawn);
        const activity = deps.onToolActivity && toolActivityIn(frame);
        if (activity) deps.onToolActivity?.(activity);
      }
      if (bootstrap.has(sessionId)) {
        transcript.appendReplay(sessionId, line);
      } else {
        const reportedModel = extractReportedModel(frame);
        if (reportedModel !== null) turnModels.set(sessionId, reportedModel);
        const reportedMode = extractReportedMode(frame);
        if (reportedMode !== null) {
          appliedSettings
            .get(sessionId)
            ?.set(
              MODE_SETTING_KEY,
              JSON.stringify({ sessionId, modeId: reportedMode }),
            );
          const entry = deps.sessionMetadata?.get(sessionId);
          const id = deps.modeSettingId;
          if (
            id &&
            entry &&
            !modeReportIsRuntimeWork(sessionId) &&
            entry.meta.settings?.[id] !== reportedMode
          ) {
            deps.sessionMetadata?.set(sessionId, {
              ...entry.meta,
              settings: { ...entry.meta.settings, [id]: reportedMode },
            });
            dropQueuedModeWork(sessionId);
          }
        }
        harnessActivity.noteUpdate(sessionId, toolCallStateOf(frame));
        const text = extractAgentTextChunk(frame);
        if (
          text !== null &&
          (promptScheduler.isRunTurn(sessionId) ||
            heldRuns.has(sessionId) ||
            isRunSession(sessionId))
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
        else trackSteerPoint(sessionId, frame);
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
      const answered = pendingRequests.answer(withoutAnsweredBy(frame));
      if (answered === null) return;
      recordVerdict(answered, frame);
      lease.maybeRecycle();
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
          parsed.success &&
          updateQueuedPrompt(
            paramsSid,
            parsed.data,
            stampedSenderOf((frame as { params?: unknown }).params, "sender"),
          );
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

      if (method === "platform/steerQueued" && paramsSid) {
        const parsed = platformSteerQueuedParamsSchema.safeParse(
          (frame as { params?: unknown }).params,
        );
        const fate = parsed.success
          ? promptScheduler.steerNow(paramsSid, parsed.data.promptId)
          : "not-queued";
        if (fate === "cannot-steer") {
          sendToChannel(
            channel,
            JSON.stringify({
              jsonrpc: "2.0",
              id: frame.id,
              error: {
                code: -32000,
                message:
                  "This agent can't take a message mid-turn; it is sent when the turn ends.",
              },
            }),
          );
          return;
        }
        answerQueueEdit(channel, frame.id, fate === "sent");
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
        const response =
          promptScheduler.hasWork(paramsSid) || heldRuns.has(paramsSid)
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
        const sender = stampedSenderOf(
          (frame as { params?: unknown }).params,
          "sender",
        );
        if (parsed.success)
          rewriteFrom(channel, frame.id, {
            ...parsed.data,
            ...(sender !== null && { sender }),
          });
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
            tail: platformOf(frame)?.tail === true,
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
      if (promptSessionId !== null) deps.onPrompt?.();

      const continuedFrom =
        method === "session/new" ? extractContinuedFrom(frame) : undefined;
      if (continuedFrom === null) {
        sendToChannel(
          channel,
          JSON.stringify({
            jsonrpc: "2.0",
            id: frame.id,
            error: {
              code: -32602,
              message:
                "the sub-agent's prompt or result is too large to continue from",
            },
          }),
        );
        return;
      }
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
      mapOutbound(outboundId, {
        channel,
        originalId: frame.id,
        method,
        promptSessionId,
        platformMeta,
        ...(continuedFrom !== undefined && { continuedFrom }),
        ...(settingSessionId !== null && { settingSessionId }),
      });

      if (promptSessionId !== null) {
        deps.sessionMetadata?.recordActivity(promptSessionId);
        if (hasSeeingViewer(promptSessionId))
          deps.sessionMetadata?.recordSeen(promptSessionId);
        const surface = platformString(frame, "surface");
        const typedPrompt = (frame as { params?: { prompt?: unknown } }).params
          ?.prompt;
        const meta = deps.sessionMetadata?.get(promptSessionId)?.meta;
        const title = meta && !meta.title ? promptTitle(typedPrompt) : null;
        if (title)
          deps.sessionMetadata?.set(promptSessionId, { ...meta, title });

        syncSettings(promptSessionId);
        const sender = stampedSenderOf(
          (frame as { params?: unknown }).params,
          "sender",
        );
        const fate = submitPrompt(rewritten, {
          sessionId: promptSessionId,
          channel,
          outboundId,
          originalId: frame.id,
          promptId,
          runPrompt: surface === "cli",
          source: frame,
          typed: typedPrompt,
          blocks: queueableBlocks(typedPrompt),
          editable: surface === "ui",
          steerable: surface === "ui" || surface === MESSAGE_SURFACE,
          unattended:
            nonViewerChannels.has(channel) &&
            (isMachineSession(promptSessionId) ||
              surface === SCHEDULE_SURFACE ||
              surface === MESSAGE_SURFACE),
          ...(sender !== null && { sender }),
        });
        if (fate === "refused") return;
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
          modeRole:
            modeRoleOfFrame(
              rewritten,
              deps.modelSettingConfig,
              deps.modeSettingId,
              deps.sessionMetadata?.get(settingSessionId)?.meta.settings?.[
                deps.modeSettingId ?? ""
              ],
              true,
            ) ?? undefined,
        });
        if (
          fate === "queued" &&
          harnessColdSessions.has(settingSessionId) &&
          !rehydratingSessions.has(settingSessionId)
        )
          startHarnessRehydrate(settingSessionId);
        return;
      }

      sendToHarness(rewritten);
      return;
    }

    const notifSid = extractParamsSessionId(frame);
    if (notifSid) engage(channel, notifSid);
    const held = notifSid === null ? undefined : heldRuns.get(notifSid);
    if (held && (frame as { method?: unknown }).method === "session/cancel")
      held.cancelled = true;
    sendToHarness(rewriteCwd(frame, deps.workingDir));
  }

  return {
    attach(channel, opts) {
      engagedSessions.set(channel, new Set());
      if (opts?.viewer === false) nonViewerChannels.add(channel);
      if (opts?.marksSeen === false) unseeingChannels.add(channel);
      const buffered: string[] = [];
      let live = false;
      waitingAttaches++;
      const release = (): void => {
        if (live) return;
        live = true;
        waitingAttaches--;
        if (!lease.ensure()) {
          channel.close(1011, "agent process is not running");
          return;
        }
        for (const data of buffered) handleClientMessage(channel, data);
        buffered.length = 0;
      };
      channel.onMessage((data) => {
        if (live) handleClientMessage(channel, data);
        else buffered.push(data);
      });
      let cancelReady: () => void = () => {};
      channel.onClose(() => {
        if (!live) {
          live = true;
          waitingAttaches--;
        }
        cancelReady();
        detach(channel);
      });
      cancelReady = lease.whenReady(release);
    },

    prestart() {
      lease.whenReady(() => lease.ensure());
    },

    status() {
      return {
        idle: !runtimeBusy(),
        backgroundWork: deps.backgroundWork.held(),
      };
    },

    isSessionRunning(sessionId) {
      return sessionIsRunning(sessionId);
    },

    toolCallsOpen(sessionId) {
      return (openToolCalls.get(sessionId)?.size ?? 0) > 0;
    },

    harnessBusy(sessionId) {
      return harnessActivity.isBusy(sessionId);
    },

    sessionFrames(sessionId) {
      return transcript.lines(sessionId);
    },

    resetSession(sessionId) {
      tearDownSession(sessionId);
      deps.log?.(`reset session ${sessionId}`);
    },

    markSessionCold(sessionId) {
      harnessColdSessions.add(sessionId);
      appliedSettings.delete(sessionId);
    },

    syncSessionSettings(sessionId) {
      syncSettings(sessionId);
    },

    releaseSession(sessionId) {
      tearDownSession(sessionId);
      for (const sessions of engagedSessions.values())
        sessions.delete(sessionId);
    },

    holdsSessions() {
      for (const sessions of engagedSessions.values())
        if (sessions.size > 0) return true;
      return (
        runtimeBusy() ||
        waitingAttaches > 0 ||
        outboundIdToClient.size > 0 ||
        (sessionCloseSupported && transcript.sessionCount() > 0)
      );
    },

    refreshEnv(opts) {
      lease.refreshEnv(opts);
    },

    recycleForConfig() {
      lease.recycleForConfig();
    },

    harnesses() {
      const pid = lease.pid();
      if (pid === null) return [];
      return [{ pid, turnSince: promptScheduler.activeTurnSince() }];
    },

    pendingRestart,

    applyPendingRestart() {
      if (pendingRestart() === null) return false;
      return lease.recycleNow();
    },

    onPendingRestartChange(cb) {
      pendingRestartListeners.push(cb);
    },

    shutdown(scope = "process") {
      processExiting = scope === "process";
      lease.shutdown();
    },
  };
}

function extractContinuedFrom(
  frame: unknown,
): PlatformContinuedFrom | null | undefined {
  const raw = platformOf(frame)?.continuedFrom;
  if (raw === undefined) return undefined;
  const parsed = platformContinuedFromSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function extractPlatformMeta(frame: unknown): PlatformSessionMeta | null {
  const parsed = platformSessionMetaSchema.safeParse(platformOf(frame));
  return parsed.success ? parsed.data : null;
}

function platformString(frame: unknown, key: string): string | null {
  const value = stringAt(platformOf(frame), key);
  return value === "" ? null : value;
}

const TITLE_CHARS = 80;

function promptTitle(prompt: unknown): string | null {
  if (!Array.isArray(prompt)) return null;
  const joined = prompt
    .map((b) =>
      isNonNullObject(b) && b.type === "text" && typeof b.text === "string"
        ? b.text
        : "",
    )
    .join(" ");
  const text = separateRendererBlocks(joined).text.replace(/\s+/g, " ");
  if (!text) return null;
  return text.length > TITLE_CHARS
    ? `${text.slice(0, TITLE_CHARS - 1)}…`
    : text;
}

function rehydrateFailureMessage(error: unknown): string {
  if (isNonNullObject(error) && typeof error.message === "string")
    return error.message;
  return "the harness could not load this conversation; the message was not sent";
}

function extractUndeliveredId(frame: unknown): string | null {
  const id = stringAt(paramsOf(frame), "id");
  return id === "" ? null : id;
}

const HANDOVER_PROMPT_CAP = 32;

function extractUndeliveredPrompts(
  frame: unknown,
): PlatformUndeliveredPrompt[] | null {
  const parsed = z
    .array(platformUndeliveredPromptSchema)
    .max(HANDOVER_PROMPT_CAP)
    .safeParse(paramsOf(frame)?.prompts);
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
  if (!isNonNullObject(params._meta)) return frame as object;
  return withPlatform(frame, () => null);
}

function toAcpPlatformMeta(session: Session): Record<string, unknown> {
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
    ...(session.harness !== undefined && { harness: session.harness }),
    ...(session.provider !== undefined && { provider: session.provider }),
    ...(session.model !== undefined && { model: session.model }),
    ...(session.customTitle !== undefined && {
      customTitle: session.customTitle,
    }),
    ...(session.autoTitle !== undefined && { autoTitle: session.autoTitle }),
  };
}

export function sessionListAnswer(
  store: SessionMetadataStore,
  isRunning: (sessionId: string) => boolean,
  platformSessionOf: PlatformSessionOf | undefined,
): unknown {
  const answered = injectPlatformMetaIntoList(
    { result: { sessions: [] } },
    store,
    isRunning,
    platformSessionOf,
  ) as { result: unknown };
  return answered.result;
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
  const caps = resultOf(frame)?.agentCapabilities;
  if (!isNonNullObject(caps)) return false;
  const session = caps.sessionCapabilities;
  return isNonNullObject(session) && isNonNullObject(session[name]);
}

function isAgentOutputChunk(frame: unknown): boolean {
  const kind = sessionUpdateOf(frame)?.sessionUpdate;
  return kind === "agent_message_chunk" || kind === "agent_thought_chunk";
}

function toolCallStateOf(
  frame: unknown,
): { toolCallId: string; started: boolean; settled: boolean } | null {
  const update = sessionUpdateOf(frame);
  if (update === null) return null;
  const { sessionUpdate, toolCallId, status } = update;
  if (sessionUpdate !== "tool_call" && sessionUpdate !== "tool_call_update")
    return null;
  if (typeof toolCallId !== "string") return null;
  const settled = status === "completed" || status === "failed";
  const started = sessionUpdate === "tool_call";
  if (!started && !settled) return null;
  return { toolCallId, started, settled };
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
  const stopReason = stringAt(resultOf(frame), "stopReason");
  return stopReason === "" ? null : stopReason;
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
  const update = sessionUpdateOf(frame);
  const meta = isNonNullObject(update?._meta) ? update._meta : null;
  const model = meta?.[REPORTED_MODEL_META_KEY];
  return typeof model === "string" && model !== "" && model !== "<synthetic>"
    ? model
    : null;
}

const NO_RESPONSE_FILLER = "No response requested.";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The line Claude's SDK makes up, without a model
 * call, when a session it resumes ends on a stopped turn.
 */
function isNoResponseFiller(frame: unknown): boolean {
  const update = sessionUpdateOf(frame);
  if (update === null) return false;
  const content = update.content;
  return (
    update.sessionUpdate === "agent_message_chunk" &&
    isNonNullObject(update._meta) &&
    update._meta[REPORTED_MODEL_META_KEY] === "<synthetic>" &&
    isNonNullObject(content) &&
    content.text === NO_RESPONSE_FILLER
  );
}

const MODE_SETTING_KEY = "session/set_mode:";

/**
 * UNIT_BOUNDARY_DESCRIPTION: what a setting does to the session's mode. A mode
 * someone chose makes that mode the session's, and the harness's report of it
 * confirms the choice: a client's own request, or the mode the owner saved,
 * which the runtime sends for it. The mode the runtime derived, and the model,
 * which the harness reconciles a mode against, make the harness report a mode
 * the setting caused, not one the session took. Every other setting leaves the
 * mode alone.
 */
function modeRoleOfFrame(
  frame: unknown,
  modelSettingConfig: string | undefined,
  modeSettingId: string | undefined,
  chosenMode: string | undefined,
  fromClient: boolean,
): ModeRole | null {
  const setting = frame as
    | { method?: unknown; params?: { configId?: unknown; modeId?: unknown } }
    | null
    | undefined;
  if (setting?.method === "session/set_mode")
    return fromClient || setting.params?.modeId === chosenMode
      ? "owner"
      : "reconcile";
  if (setting?.method !== "session/set_config_option") return null;
  const configId = setting.params?.configId;
  if (modelSettingConfig !== undefined && configId === modelSettingConfig)
    return "reconcile";
  return modeSettingId !== undefined && configId === modeSettingId
    ? fromClient
      ? "owner"
      : "reconcile"
    : null;
}

function settingKeyOf({ method, params }: SessionSettingFrame): string {
  return `${method}:${String(params.configId ?? "")}`;
}

function extractReportedMode(frame: unknown): string | null {
  const update = sessionUpdateOf(frame);
  const mode = update?.currentModeId;
  return update?.sessionUpdate === "current_mode_update" &&
    typeof mode === "string" &&
    mode !== ""
    ? mode
    : null;
}

function sessionUpdateKind(frame: unknown): string | null {
  const kind = sessionUpdateOf(frame)?.sessionUpdate;
  return typeof kind === "string" ? kind : null;
}

function extractAgentTextChunk(frame: unknown): string | null {
  const update = sessionUpdateOf(frame);
  if (update?.sessionUpdate !== "agent_message_chunk") return null;
  const content = update.content;
  if (!isNonNullObject(content) || content.type !== "text") return null;
  return typeof content.text === "string" ? content.text : null;
}

function extractParamsSessionId(frame: unknown): string | null {
  return stringAt(paramsOf(frame), "sessionId");
}

function extractAgentRequestSessionId(frame: unknown): string | null {
  const sid = extractParamsSessionId(frame);
  return sid === "" ? null : sid;
}

function extractResultSessionId(frame: unknown): string | null {
  return stringAt(resultOf(frame), "sessionId");
}
