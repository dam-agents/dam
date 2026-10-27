import {
  buildPlatformPromptAcceptedNotification,
  buildPlatformPromptStartedNotification,
  PROMPT_QUEUE_FULL_CODE,
  PROMPT_QUEUE_FULL_MESSAGE,
} from "api-server-api";
import type { Sender } from "agent-runtime-api";
import type { PromptBlock, QueuedPrompt } from "api-server-api";

import { randomUUID } from "node:crypto";

import type { JsonRpcId } from "api-server-api";
import type { ClientChannel } from "../../infrastructure/client-channel.js";

const PROMPT_QUEUE_CAP = 32;
const DEFAULT_QUEUE_PARK_MS = 90 * 1000;
const DEFAULT_STEER_WAIT_MS = 60 * 1000;

export type PromptFate = "started" | "queued" | "steering" | "refused";

export type SteerNowFate = "sent" | "not-queued" | "cannot-steer";

export type SteerOutcome = "injected" | "refused";

export type QueueDropCause =
  "park-expired" | "session-forgotten" | "scheduler-cleared";

export type SteerOnlyAnswer =
  "injected" | "noRunningTurn" | "notYourTurn" | "queueFull";

/**
 * UNIT_BOUNDARY_DESCRIPTION: a steer a client asked for with
 * `_session/steering`. It may only join the turn its target prompt runs, and
 * it is answered once, at the moment it joins or leaves the queue, never with
 * a turn's stopReason.
 */
export interface SteerOnly {
  targetPromptId: string;
  answer: (answer: SteerOnlyAnswer) => void;
}

export interface PromptSubmission {
  sessionId: string;
  channel: ClientChannel;
  outboundId: number;
  originalId: JsonRpcId | null;
  frame: unknown;
  promptId: string | null;
  runPrompt?: boolean;
  unattended?: boolean;
  source?: unknown;
  typed?: unknown;
  blocks?: PromptBlock[];
  editable?: boolean;
  steerable?: boolean;
  steerRefused?: boolean;
  steerNow?: boolean;
  queuedAt?: string;
  modeRole?: ModeRole;
  sender?: Sender;
  steerOnly?: SteerOnly;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: what a setting does to the session's mode. A
 * `reconcile` setting makes the harness report a mode the runtime caused — a
 * mode it derived, or the fallback a model change forced — so such a report is
 * not the session's. An `owner` setting is a mode the owner chose, which a
 * report of it confirms rather than replaces.
 */
export type ModeRole = "reconcile" | "owner";

export interface ModeWork {
  role: ModeRole;
  sent: boolean;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: settings are submitted in the order the runtime
 * wants them applied and sent one at a time, each after the harness answered
 * the one before, because a harness reads a setting against the state an
 * earlier one left — a mode against the model the session holds. A prompt
 * waits for both. A setting the harness refused is asked for again as one block,
 * ahead of the queue and in the order the runtime lists it, so what depends on
 * it never applies against the state it failed to reach.
 * A submission says what its answer does to the mode (its ModeRole), and the
 * scheduler reports the mode work it holds, sent or still queued, so the runtime
 * can tell which mode reports it caused and which the session took.
 */
export interface PromptScheduler {
  submit(submission: PromptSubmission): PromptFate;
  submitSetting(submission: PromptSubmission): PromptFate;
  submitSettings(submissions: PromptSubmission[], first?: boolean): void;
  dropQueuedSettings(
    sessionId: string,
    predicate: (entry: PromptSubmission) => boolean,
  ): PromptSubmission[];
  onSettingResponse(sessionId: string, outboundId: number): void;
  modeWork(sessionId: string): ModeWork[];
  onPromptResponse(
    sessionId: string,
    outboundId: number,
  ): {
    turnEnded: boolean;
    promptId: string | null;
    turnId: string | null;
    runPrompt: boolean;
    steered: PromptSubmission[];
  };
  activeTurnId(sessionId: string): string | null;
  hasTurnInFlight(sessionId: string): boolean;
  isRunTurn(sessionId: string): boolean;
  hasWork(sessionId: string): boolean;
  anyWork(): boolean;
  activeTurnCount(): number;
  activeTurnSince(): number | null;
  onEngaged(sessionId: string): void;
  onSessionReady(sessionId: string): void;
  onDetached(sessionId: string): void;
  refuseQueue(sessionId: string, message: string): void;
  snapshot(sessionId: string): QueuedPrompt[];
  update(
    sessionId: string,
    promptId: string,
    edit: (
      entry: PromptSubmission,
    ) => Pick<
      PromptSubmission,
      "source" | "frame" | "typed" | "blocks" | "sender"
    >,
  ): boolean;
  remove(sessionId: string, promptId: string): PromptSubmission | null;
  steerNow(sessionId: string, promptId: string): SteerNowFate;
  adoptSteer(sessionId: string, promptId: string, channel: ClientChannel): void;
  withdraw(channel: ClientChannel): PromptSubmission[];
  onSteerPoint(sessionId: string): void;
  forget(sessionId: string): void;
  clear(): void;
}

export interface PromptSchedulerDeps {
  sendToAgent: (frame: unknown) => boolean;
  modeRoleOf?: (entry: PromptSubmission) => ModeRole | null;
  canStart: (entry: PromptSubmission) => boolean;
  sessionLoaded?: (sessionId: string) => boolean;
  onQueueDropped: (
    sessionId: string,
    dropped: PromptSubmission[],
    cause: QueueDropCause,
  ) => void;
  onTurnStarted?: (submission: PromptSubmission) => void;
  canSteer?: (sessionId: string) => boolean;
  steer?: (submission: PromptSubmission) => Promise<SteerOutcome>;
  onSteered?: (submission: PromptSubmission, turnEnded: boolean) => void;
  onQueueChanged?: (sessionId: string) => void;
  onTurnEnded?: (sessionId: string) => void;
  onTurnInterrupted?: (
    sessionId: string,
    turn: { promptId: string | null; runPrompt: boolean },
  ) => void;
  atSteerPoint?: (sessionId: string) => boolean;
  queueParkMs?: number;
  steerWaitMs?: number;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Runs each session one turn at a time. A prompt
 * submitted while a turn is in flight is queued (up to a cap, then refused
 * with a structured error) and promoted when the turn ahead of it ends. The
 * scheduler tells the sender each prompt's fate itself — accepted, queued,
 * started — over the sender's own channel, and answers the runtime's
 * busy/idle questions about turn state. Every change to a queue is announced
 * over onQueueChanged and snapshot lists it, so every viewer sees the same
 * queue the scheduler holds.
 * A steerable prompt that arrives while a turn runs and nothing waits ahead of
 * it is steered into that turn instead of queued, when the harness steers; so
 * is the queue, whenever a turn is running and no steer is out. Steerable
 * prompts waiting together go as one batch — one message carrying each of
 * them in order — because a later one may change what an earlier one asked,
 * and because the harness merges steers that arrive together on its own, in
 * no reliable order. A turn that ends with steerable prompts waiting starts
 * them the same way: the first opens the turn carrying all of them, and the
 * rest join it as steered. A steer waits for a
 * steer point — the agent is not writing and has no tool call open, which is
 * right after its tools finish — because the harness aborts whatever the agent
 * is generating to take a steer, and would cut a reply off mid-sentence. Until
 * then the prompt is an ordinary queued one, editable; a turn that ends first
 * starts it as the next turn, and a prompt that has waited steerWaitMs is
 * steered regardless; so is one the user asks to send now (steerNow), with
 * every prompt queued before it, accepting the cut. The steer is a round
 * trip: while it is out, the queue holds, so a turn ending in that window
 * cannot start a later prompt ahead of it. Injected, each prompt of the batch
 * is part of the running turn and its sender is answered when that turn ends;
 * refused, the batch goes back to the head of the queue in order and waits for
 * the next turn. Either way each prompt reaches the harness once.
 * A turn becomes active only when the harness actually took the frame:
 * sendToAgent reports delivery, and on failure the prompt stays queued and
 * no promptStarted is sent. The turn-started and turn-ended callbacks fire on
 * every path that starts or drops an active turn, so an observer timing a turn
 * cannot be left with one it believes is still running.
 * A queued prompt starts only when its session can take one — a channel
 * engaged to read the answer, and the harness holding the session — so this
 * is the single place anything waits, whether it waits for the turn ahead or
 * for the session to be loaded back into the harness. An unattended prompt
 * is the exception: a scheduled fire sent by a non-viewer channel has nobody
 * reading it live and nobody coming back for it, so it waits for the harness
 * alone, and a queue holding only such prompts is never parked. Otherwise the
 * last channel leaving parks the queue rather than dropping it, so a page
 * reload keeps its place; a client that engages again within the park window
 * resumes the queue, and only when that window passes with nobody back is the
 * queue dropped. Every route a queue can leave by — that window expiring, the
 * session being forgotten, the scheduler being cleared when the harness goes
 * down — announces it over onQueueDropped with the cause, so a queue cannot
 * be discarded anywhere without its prompts being written down first. Nothing
 * outside this module ever removes a queue itself. refuseQueue is the one
 * exception and answers each sender with an error instead, so the loss is
 * reported to the client that is still there to hear it rather than recorded.
 * A setting change for a session (its model or mode) waits in the same place
 * but is not a turn: it applies to the session's next turn, so it waits for
 * the turn in flight to end and for the session to be loaded back into the
 * harness, never for an engaged reader. It goes out ahead of the queued
 * prompts, and the next prompt waits for the harness to answer it. It is
 * dropped unsent once its sender has gone, and on every route a queue leaves
 * by is answered with an error rather than written down, since nothing
 * replays a setting.
 */
export function createPromptScheduler(
  deps: PromptSchedulerDeps,
): PromptScheduler {
  const activeTurns = new Map<
    string,
    {
      outboundId: number;
      promptId: string | null;
      turnId: string;
      runPrompt: boolean;
      steered: PromptSubmission[];
      startedAt: number;
    }
  >();
  const steering = new Map<string, PromptSubmission>();
  const steeringBatches = new WeakMap<PromptSubmission, PromptSubmission[]>();
  const steerTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const queues = new Map<string, PromptSubmission[]>();
  const pendingSettings = new Map<string, PromptSubmission[]>();
  const settingsInFlight = new Map<string, Map<number, PromptSubmission>>();
  const parkTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const queueParkMs = deps.queueParkMs ?? DEFAULT_QUEUE_PARK_MS;
  const steerWaitMs = deps.steerWaitMs ?? DEFAULT_STEER_WAIT_MS;

  function clearSteerTimer(sessionId: string): void {
    const timer = steerTimers.get(sessionId);
    if (timer !== undefined) clearTimeout(timer);
    steerTimers.delete(sessionId);
  }

  function waitedOut(entry: PromptSubmission): boolean {
    return (
      entry.queuedAt !== undefined &&
      Date.now() - Date.parse(entry.queuedAt) >= steerWaitMs
    );
  }

  function clearParkTimer(sessionId: string): void {
    const timer = parkTimers.get(sessionId);
    if (timer !== undefined) clearTimeout(timer);
    parkTimers.delete(sessionId);
  }

  function joinsActiveTurn(entry: PromptSubmission): boolean {
    return (
      entry.steerOnly === undefined ||
      entry.steerOnly.targetPromptId ===
        activeTurns.get(entry.sessionId)?.promptId
    );
  }

  function targetLive(sessionId: string, targetPromptId: string): boolean {
    return (
      activeTurns.get(sessionId)?.promptId === targetPromptId ||
      (queues.get(sessionId) ?? []).some(
        (entry) =>
          entry.steerOnly === undefined && entry.promptId === targetPromptId,
      )
    );
  }

  function strandedAnswer(sessionId: string): SteerOnlyAnswer {
    return activeTurns.has(sessionId) ? "notYourTurn" : "noRunningTurn";
  }

  function answerSteerOnly(
    entries: PromptSubmission[],
    answer: SteerOnlyAnswer,
  ): PromptSubmission[] {
    const ordinary: PromptSubmission[] = [];
    for (const entry of entries) {
      if (entry.steerOnly === undefined) ordinary.push(entry);
      else entry.steerOnly.answer(answer);
    }
    return ordinary;
  }

  function replaceQueue(sessionId: string, kept: PromptSubmission[]): void {
    if (kept.length > 0) {
      queues.set(sessionId, kept);
    } else {
      queues.delete(sessionId);
      clearParkTimer(sessionId);
    }
    deps.onQueueChanged?.(sessionId);
  }

  function answerStrandedSteers(sessionId: string): void {
    const queue = queues.get(sessionId);
    if (queue === undefined) return;
    const stranded = queue.filter(
      (entry) =>
        entry.steerOnly !== undefined &&
        !targetLive(sessionId, entry.steerOnly.targetPromptId),
    );
    if (stranded.length === 0) return;
    replaceQueue(
      sessionId,
      queue.filter((entry) => !stranded.includes(entry)),
    );
    answerSteerOnly(stranded, strandedAnswer(sessionId));
  }

  function refuseSettings(sessionId: string, message: string): void {
    const settings = pendingSettings.get(sessionId);
    pendingSettings.delete(sessionId);
    for (const entry of settings ?? []) refuse(entry, message);
  }

  const sessionLoaded = (entry: PromptSubmission): boolean =>
    deps.sessionLoaded
      ? deps.sessionLoaded(entry.sessionId)
      : deps.canStart(entry);

  function dropAbandonedSettings(sessionId: string): void {
    const settings = pendingSettings.get(sessionId);
    if (settings === undefined) return;
    const live = settings.filter((entry) => entry.channel.isOpen());
    if (live.length === 0) pendingSettings.delete(sessionId);
    else pendingSettings.set(sessionId, live);
  }

  function flushSettings(sessionId: string): void {
    dropAbandonedSettings(sessionId);
    if (settingsInFlight.has(sessionId)) return;
    const settings = pendingSettings.get(sessionId);
    const head = settings?.[0];
    if (settings === undefined || head === undefined) return;
    if (activeTurns.has(sessionId) || !sessionLoaded(head)) return;
    if (!sendSetting(head)) return;
    settings.shift();
    if (settings.length === 0) pendingSettings.delete(sessionId);
  }

  function sendSetting(entry: PromptSubmission): boolean {
    if (!deps.sendToAgent(entry.frame)) return false;
    const inFlight =
      settingsInFlight.get(entry.sessionId) ??
      new Map<number, PromptSubmission>();
    inFlight.set(entry.outboundId, entry);
    settingsInFlight.set(entry.sessionId, inFlight);
    return true;
  }

  function dropQueue(sessionId: string, cause: QueueDropCause): void {
    clearSteerTimer(sessionId);
    refuseSettings(
      sessionId,
      `the setting was not applied: the session's queue was dropped (${cause})`,
    );
    clearParkTimer(sessionId);
    const inFlight = steering.get(sessionId);
    steering.delete(sessionId);
    const inFlightOrdinary =
      inFlight === undefined
        ? []
        : answerSteerOnly(
            steeringBatches.get(inFlight) ?? [inFlight],
            "noRunningTurn",
          );
    const queued = queues.get(sessionId);
    const dropped = [
      ...(inFlightOrdinary.length === 0 ? [] : [leadOf(inFlightOrdinary)]),
      ...answerSteerOnly(queued ?? [], "noRunningTurn"),
    ];
    queues.delete(sessionId);
    if (inFlight === undefined && queued === undefined) return;
    deps.onQueueChanged?.(sessionId);
    if (dropped.length > 0) deps.onQueueDropped(sessionId, dropped, cause);
  }

  function sendToChannel(channel: ClientChannel, line: string): void {
    if (channel.isOpen()) channel.send(line);
  }

  function notifyAccepted(
    entry: PromptSubmission,
    queued: boolean,
    steered = false,
  ): void {
    if (entry.promptId === null || entry.steerOnly !== undefined) return;
    sendToChannel(
      entry.channel,
      JSON.stringify(
        buildPlatformPromptAcceptedNotification({
          sessionId: entry.sessionId,
          promptId: entry.promptId,
          queued,
          ...(steered && { steered: true }),
        }),
      ),
    );
  }

  function enqueue(entry: PromptSubmission, atHead: boolean): void {
    const queue = queues.get(entry.sessionId) ?? [];
    entry.queuedAt = new Date().toISOString();
    if (atHead) queue.unshift(entry);
    else queue.push(entry);
    queues.set(entry.sessionId, queue);
    deps.onQueueChanged?.(entry.sessionId);
  }

  function canSteerNow(entry: PromptSubmission): boolean {
    const sessionId = entry.sessionId;
    return (
      entry.steerable === true &&
      entry.steerRefused !== true &&
      joinsActiveTurn(entry) &&
      ((deps.atSteerPoint?.(sessionId) ?? true) ||
        waitedOut(entry) ||
        entry.steerNow === true) &&
      deps.steer !== undefined &&
      activeTurns.has(sessionId) &&
      !steering.has(sessionId) &&
      !pendingSettings.has(sessionId) &&
      !settingsInFlight.has(sessionId) &&
      (deps.canSteer?.(sessionId) ?? false) &&
      deps.canStart(entry)
    );
  }

  function takeBatch(
    queue: PromptSubmission[],
    into: "steer" | "start",
  ): PromptSubmission[] {
    const head = queue.shift();
    if (head === undefined) return [];
    const batch = [head];
    while (
      head.steerable === true &&
      queue[0]?.steerable === true &&
      (queue[0].steerOnly === undefined ||
        (into === "steer" && joinsActiveTurn(queue[0]))) &&
      deps.canStart(queue[0])
    )
      batch.push(queue.shift()!);
    return batch;
  }

  function leadOf(batch: PromptSubmission[]): PromptSubmission {
    const head = batch[0]!;
    if (batch.length === 1) return head;
    const frame = head.frame as { params?: Record<string, unknown> };
    const prompt = batch.flatMap(
      (m) =>
        ((m.frame as { params?: { prompt?: unknown[] } }).params?.prompt ??
          []) as unknown[],
    );
    return {
      ...head,
      frame: { ...frame, params: { ...frame.params, prompt } },
    };
  }

  function nothingAhead(sessionId: string): boolean {
    return (
      !activeTurns.has(sessionId) &&
      !steering.has(sessionId) &&
      !pendingSettings.has(sessionId) &&
      !settingsInFlight.has(sessionId)
    );
  }

  function firstBatchSize(queue: readonly PromptSubmission[]): number {
    if (queue.length === 0 || queue[0]!.steerOnly !== undefined) return 0;
    if (queue[0]!.steerable !== true) return 1;
    const plain = queue.findIndex(
      (entry) => entry.steerable !== true || entry.steerOnly !== undefined,
    );
    return plain === -1 ? queue.length : plain;
  }

  function joinTurn(sessionId: string, follower: PromptSubmission): void {
    const active = activeTurns.get(sessionId);
    if (follower.steerOnly !== undefined) {
      deps.onSteered?.(follower, active === undefined);
      follower.steerOnly.answer("injected");
      return;
    }
    notifyAccepted(follower, false, true);
    active?.steered.push(follower);
    deps.onSteered?.(follower, active === undefined);
  }

  function beginSteer(batch: PromptSubmission[]): void {
    const entry = leadOf(batch);
    steeringBatches.set(entry, batch);
    steering.set(entry.sessionId, entry);
    const steer = deps.steer;
    if (steer === undefined) return;
    steer(entry).then(
      (outcome) => settleSteer(entry, outcome),
      () => settleSteer(entry, "refused"),
    );
  }

  function steerFromQueue(sessionId: string): void {
    clearSteerTimer(sessionId);
    answerStrandedSteers(sessionId);
    const queue = queues.get(sessionId);
    const head = queue?.[0];
    if (queue === undefined || head === undefined) return;
    if (canSteerNow(head)) {
      const batch = takeBatch(queue, "steer");
      if (queue.length === 0) queues.delete(sessionId);
      deps.onQueueChanged?.(sessionId);
      beginSteer(batch);
      return;
    }
    if (
      head.steerable !== true ||
      head.steerRefused === true ||
      head.queuedAt === undefined ||
      !activeTurns.has(sessionId) ||
      !(deps.canSteer?.(sessionId) ?? false)
    )
      return;
    const wait = steerWaitMs - (Date.now() - Date.parse(head.queuedAt));
    if (wait <= 0) return;
    steerTimers.set(
      sessionId,
      setTimeout(() => steerFromQueue(sessionId), wait),
    );
  }

  function settleSteer(entry: PromptSubmission, outcome: SteerOutcome): void {
    const sessionId = entry.sessionId;
    if (steering.get(sessionId) !== entry) return;
    steering.delete(sessionId);
    const batch = steeringBatches.get(entry) ?? [entry];
    if (outcome === "refused") {
      const ordinary = answerSteerOnly(batch, "noRunningTurn");
      for (const member of [...ordinary].reverse()) {
        member.steerRefused = true;
        enqueue(member, true);
      }
      for (const member of ordinary) notifyAccepted(member, true);
      maybeStartNext(sessionId);
      return;
    }
    for (const member of batch) joinTurn(sessionId, member);
    if (!activeTurns.has(sessionId)) maybeStartNext(sessionId);
    else steerFromQueue(sessionId);
  }

  function start(entry: PromptSubmission): boolean {
    if (!deps.sendToAgent(entry.frame)) return false;
    clearParkTimer(entry.sessionId);
    activeTurns.set(entry.sessionId, {
      outboundId: entry.outboundId,
      promptId: entry.promptId,
      turnId: entry.promptId ?? randomUUID(),
      runPrompt: entry.runPrompt ?? false,
      steered: [],
      startedAt: Date.now(),
    });
    deps.onTurnStarted?.(entry);
    if (entry.promptId !== null) {
      sendToChannel(
        entry.channel,
        JSON.stringify(
          buildPlatformPromptStartedNotification({
            sessionId: entry.sessionId,
            promptId: entry.promptId,
          }),
        ),
      );
    }
    return true;
  }

  function maybeStartNext(sessionId: string): void {
    flushSettings(sessionId);
    if (pendingSettings.has(sessionId)) return;
    if (settingsInFlight.has(sessionId)) return;
    if (activeTurns.has(sessionId) || steering.has(sessionId)) return;
    answerStrandedSteers(sessionId);
    const queue = queues.get(sessionId);
    const next = queue?.[0];
    if (queue === undefined || next === undefined) return;
    if (!deps.canStart(next)) return;
    const batch = takeBatch(queue, "start");
    if (!start(leadOf(batch))) {
      queue.unshift(...batch);
      return;
    }
    if (queue.length === 0) queues.delete(sessionId);
    deps.onQueueChanged?.(sessionId);
    for (const follower of batch.slice(1)) joinTurn(sessionId, follower);
    steerFromQueue(sessionId);
  }

  function submitSteerOnly(
    submission: PromptSubmission,
    steerOnly: SteerOnly,
  ): PromptFate {
    const sessionId = submission.sessionId;
    if (!targetLive(sessionId, steerOnly.targetPromptId)) {
      steerOnly.answer(strandedAnswer(sessionId));
      return "refused";
    }
    if (!queues.get(sessionId)?.length && canSteerNow(submission)) {
      beginSteer([submission]);
      return "steering";
    }
    if ((queues.get(sessionId)?.length ?? 0) >= PROMPT_QUEUE_CAP) {
      steerOnly.answer("queueFull");
      return "refused";
    }
    enqueue(submission, false);
    if (queues.get(sessionId)?.[0] === submission) steerFromQueue(sessionId);
    return "queued";
  }

  function refuse(entry: PromptSubmission, message?: string): void {
    if (entry.originalId === null) return;
    sendToChannel(
      entry.channel,
      JSON.stringify({
        jsonrpc: "2.0",
        id: entry.originalId,
        error:
          message === undefined
            ? {
                code: -32000,
                message: `${PROMPT_QUEUE_FULL_MESSAGE} for session ${entry.sessionId}`,
                data: { code: PROMPT_QUEUE_FULL_CODE },
              }
            : { code: -32000, message },
      }),
    );
  }

  return {
    submit(submission) {
      if (submission.steerOnly !== undefined)
        return submitSteerOnly(submission, submission.steerOnly);
      const sessionId = submission.sessionId;
      if (!queues.get(sessionId)?.length && canSteerNow(submission)) {
        beginSteer([submission]);
        return "steering";
      }
      if (
        activeTurns.has(sessionId) ||
        steering.has(sessionId) ||
        pendingSettings.has(sessionId) ||
        settingsInFlight.has(sessionId) ||
        !deps.canStart(submission)
      ) {
        if ((queues.get(sessionId)?.length ?? 0) >= PROMPT_QUEUE_CAP) {
          refuse(submission);
          return "refused";
        }
        enqueue(submission, false);
        notifyAccepted(submission, true);
        if (queues.get(sessionId)?.[0] === submission)
          steerFromQueue(sessionId);
        return "queued";
      }
      notifyAccepted(submission, false);
      if (start(submission)) return "started";
      submission.queuedAt = new Date().toISOString();
      queues.set(sessionId, [submission]);
      deps.onQueueChanged?.(sessionId);
      return "queued";
    },

    submitSetting(submission) {
      const sessionId = submission.sessionId;
      if (
        !pendingSettings.has(sessionId) &&
        !settingsInFlight.has(sessionId) &&
        !activeTurns.has(sessionId) &&
        sessionLoaded(submission) &&
        sendSetting(submission)
      )
        return "started";
      pendingSettings.set(sessionId, [
        ...(pendingSettings.get(sessionId) ?? []),
        submission,
      ]);
      return "queued";
    },

    submitSettings(submissions, first = false) {
      const sessionId = submissions[0]?.sessionId;
      if (sessionId === undefined) return;
      const queued = pendingSettings.get(sessionId) ?? [];
      pendingSettings.set(
        sessionId,
        first ? [...submissions, ...queued] : [...queued, ...submissions],
      );
      maybeStartNext(sessionId);
    },

    modeWork(sessionId) {
      const roleOf = deps.modeRoleOf;
      if (roleOf === undefined) return [];
      const work: ModeWork[] = [];
      for (const entry of settingsInFlight.get(sessionId)?.values() ?? []) {
        const role = roleOf(entry);
        if (role !== null) work.push({ role, sent: true });
      }
      for (const entry of pendingSettings.get(sessionId) ?? []) {
        const role = roleOf(entry);
        if (role !== null) work.push({ role, sent: false });
      }
      return work;
    },

    dropQueuedSettings(sessionId, predicate) {
      const queued = pendingSettings.get(sessionId);
      if (queued === undefined) return [];
      const dropped = queued.filter(predicate);
      if (dropped.length === 0) return [];
      const kept = queued.filter((entry) => !predicate(entry));
      if (kept.length === 0) pendingSettings.delete(sessionId);
      else pendingSettings.set(sessionId, kept);
      return dropped;
    },

    onSettingResponse(sessionId, outboundId) {
      const inFlight = settingsInFlight.get(sessionId);
      if (!inFlight?.delete(outboundId)) return;
      if (inFlight.size === 0) settingsInFlight.delete(sessionId);
      maybeStartNext(sessionId);
    },

    onPromptResponse(sessionId, outboundId) {
      const active = activeTurns.get(sessionId);
      if (active === undefined || active.outboundId !== outboundId) {
        return {
          turnEnded: false,
          promptId: null,
          turnId: null,
          runPrompt: false,
          steered: [],
        };
      }
      activeTurns.delete(sessionId);
      clearSteerTimer(sessionId);
      deps.onTurnEnded?.(sessionId);
      answerStrandedSteers(sessionId);
      if (queues.get(sessionId)?.length || pendingSettings.has(sessionId))
        maybeStartNext(sessionId);
      else queues.delete(sessionId);
      return {
        turnEnded: true,
        promptId: active.promptId,
        turnId: active.turnId,
        runPrompt: active.runPrompt,
        steered: active.steered,
      };
    },

    activeTurnId(sessionId) {
      return activeTurns.get(sessionId)?.turnId ?? null;
    },

    hasTurnInFlight(sessionId) {
      return activeTurns.has(sessionId);
    },

    isRunTurn(sessionId) {
      return activeTurns.get(sessionId)?.runPrompt === true;
    },

    hasWork(sessionId) {
      return (
        activeTurns.has(sessionId) ||
        steering.has(sessionId) ||
        queues.has(sessionId) ||
        pendingSettings.has(sessionId) ||
        settingsInFlight.has(sessionId)
      );
    },

    anyWork() {
      return (
        activeTurns.size > 0 ||
        steering.size > 0 ||
        queues.size > 0 ||
        pendingSettings.size > 0 ||
        settingsInFlight.size > 0
      );
    },

    activeTurnCount() {
      return activeTurns.size;
    },

    activeTurnSince() {
      let earliest: number | null = null;
      for (const turn of activeTurns.values()) {
        if (earliest === null || turn.startedAt < earliest)
          earliest = turn.startedAt;
      }
      return earliest;
    },

    onEngaged(sessionId) {
      clearParkTimer(sessionId);
      maybeStartNext(sessionId);
    },

    onSessionReady(sessionId) {
      maybeStartNext(sessionId);
    },

    refuseQueue(sessionId, message) {
      clearSteerTimer(sessionId);
      refuseSettings(sessionId, message);
      const queue = queues.get(sessionId);
      if (queue === undefined) return;
      queues.delete(sessionId);
      clearParkTimer(sessionId);
      deps.onQueueChanged?.(sessionId);
      for (const entry of answerSteerOnly(queue, "noRunningTurn"))
        refuse(entry, message);
    },

    update(sessionId, promptId, edit) {
      const entry = queues
        .get(sessionId)
        ?.find((e) => e.editable === true && e.promptId === promptId);
      if (entry === undefined) return false;
      Object.assign(entry, edit(entry));
      deps.onQueueChanged?.(sessionId);
      return true;
    },

    remove(sessionId, promptId) {
      const queue = queues.get(sessionId);
      const index =
        queue?.findIndex(
          (e) => e.editable === true && e.promptId === promptId,
        ) ?? -1;
      if (queue === undefined || index === -1) return null;
      const [entry] = queue.splice(index, 1);
      if (queue.length === 0) {
        queues.delete(sessionId);
        clearParkTimer(sessionId);
      }
      deps.onQueueChanged?.(sessionId);
      if (index === 0) steerFromQueue(sessionId);
      return entry ?? null;
    },

    steerNow(sessionId, promptId) {
      const queue = queues.get(sessionId);
      const index =
        queue?.findIndex(
          (e) => e.editable === true && e.promptId === promptId,
        ) ?? -1;
      if (queue === undefined || index === -1) return "not-queued";
      const target = queue[index]!;
      for (const entry of queue.slice(0, index + 1)) entry.steerNow = true;
      steerFromQueue(sessionId);
      if (!activeTurns.has(sessionId) || steering.has(sessionId)) return "sent";
      target.steerNow = false;
      return "cannot-steer";
    },

    adoptSteer(sessionId, promptId, channel) {
      const entry = queues
        .get(sessionId)
        ?.find((e) => e.steerOnly !== undefined && e.promptId === promptId);
      if (entry !== undefined) entry.channel = channel;
    },

    withdraw(channel) {
      const withdrawn: PromptSubmission[] = [];
      for (const [sessionId, queue] of [...queues]) {
        const gone = queue.filter(
          (entry) => entry.steerOnly !== undefined && entry.channel === channel,
        );
        if (gone.length === 0) continue;
        withdrawn.push(...gone);
        replaceQueue(
          sessionId,
          queue.filter((entry) => !gone.includes(entry)),
        );
        steerFromQueue(sessionId);
      }
      return withdrawn;
    },

    onSteerPoint(sessionId) {
      steerFromQueue(sessionId);
    },

    snapshot(sessionId) {
      const queue = queues.get(sessionId) ?? [];
      const starting = nothingAhead(sessionId) ? firstBatchSize(queue) : 0;
      return queue.map((entry, i) => ({
        promptId: entry.promptId,
        blocks: entry.blocks ?? [],
        queuedAt: entry.queuedAt ?? "",
        editable: entry.editable === true && entry.promptId !== null,
        ...(i < starting && { starting: true }),
        ...(entry.sender !== undefined && { sender: entry.sender }),
      }));
    },

    onDetached(sessionId) {
      dropAbandonedSettings(sessionId);
      const queue = queues.get(sessionId) ?? [];
      const head = queue[0];
      if (head === undefined) return;
      if (queue.every((entry) => entry.unattended === true)) return;
      if (deps.canStart(head)) return;
      if (parkTimers.has(sessionId)) return;
      parkTimers.set(
        sessionId,
        setTimeout(() => dropQueue(sessionId, "park-expired"), queueParkMs),
      );
    },

    forget(sessionId) {
      const active = activeTurns.get(sessionId);
      activeTurns.delete(sessionId);
      settingsInFlight.delete(sessionId);
      if (active !== undefined) deps.onTurnInterrupted?.(sessionId, active);
      dropQueue(sessionId, "session-forgotten");
      if (active !== undefined) deps.onTurnEnded?.(sessionId);
    },

    clear() {
      for (const timer of parkTimers.values()) clearTimeout(timer);
      parkTimers.clear();
      for (const timer of steerTimers.values()) clearTimeout(timer);
      steerTimers.clear();
      settingsInFlight.clear();
      for (const sessionId of [...pendingSettings.keys()])
        refuseSettings(
          sessionId,
          "the setting was not applied: the harness went down",
        );
      const active = [...activeTurns.entries()];
      activeTurns.clear();
      for (const [sessionId, turn] of active)
        deps.onTurnInterrupted?.(sessionId, turn);
      for (const sessionId of new Set([...queues.keys(), ...steering.keys()]))
        dropQueue(sessionId, "scheduler-cleared");
      for (const [sessionId] of active) deps.onTurnEnded?.(sessionId);
    },
  };
}
