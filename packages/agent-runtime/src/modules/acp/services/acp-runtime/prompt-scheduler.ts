import {
  buildPlatformPromptAcceptedNotification,
  buildPlatformPromptStartedNotification,
  PROMPT_QUEUE_FULL_CODE,
  PROMPT_QUEUE_FULL_MESSAGE,
} from "api-server-api";
import type { PromptBlock, QueuedPrompt } from "api-server-api";

import { randomUUID } from "node:crypto";

import type { JsonRpcId } from "../../domain/frames.js";
import type { ClientChannel } from "../../infrastructure/client-channel.js";

const PROMPT_QUEUE_CAP = 32;
const DEFAULT_QUEUE_PARK_MS = 90 * 1000;
const DEFAULT_STEER_WAIT_MS = 60 * 1000;

export type PromptFate = "started" | "queued" | "steering" | "refused";

export type SteerOutcome = "injected" | "refused";

export type QueueDropCause =
  "park-expired" | "session-forgotten" | "scheduler-cleared";

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
  queuedAt?: string;
}

export interface PromptScheduler {
  submit(submission: PromptSubmission): PromptFate;
  submitSetting(submission: PromptSubmission): PromptFate;
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
    ) => Pick<PromptSubmission, "source" | "frame" | "typed" | "blocks">,
  ): boolean;
  remove(sessionId: string, promptId: string): PromptSubmission | null;
  onToolsIdle(sessionId: string): void;
  forget(sessionId: string): void;
  clear(): void;
}

export interface PromptSchedulerDeps {
  sendToAgent: (frame: unknown) => boolean;
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
  toolsIdle?: (sessionId: string) => boolean;
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
 * is the head of the queue, one at a time, whenever a turn is running and no
 * steer is out, so a queue drains into the turn in order. A steer waits for
 * the turn's open tool calls to finish, so the agent reads it next to their
 * results; until then the prompt is an ordinary queued one, editable, and a
 * prompt that has waited steerWaitMs is steered regardless. The steer is a round
 * trip: while it is out, the queue holds, so a turn ending in that window
 * cannot start a later prompt ahead of it. Injected, the prompt is part of the
 * running turn and its sender is answered when that turn ends; refused, it
 * goes back to the head of the queue and waits for the next turn. Either way
 * it reaches the harness once.
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
 * but is not a turn: it waits only for the session to be loaded back into
 * the harness, never for a turn in flight or an engaged reader, goes out
 * ahead of the queued prompts once it can, is dropped unsent once its sender
 * has gone, and on every route a queue leaves by is answered with an error
 * rather than written down, since nothing replays a setting.
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
    }
  >();
  const steering = new Map<string, PromptSubmission>();
  const steerTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const queues = new Map<string, PromptSubmission[]>();
  const pendingSettings = new Map<string, PromptSubmission[]>();
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
    const settings = pendingSettings.get(sessionId);
    const head = settings?.[0];
    if (settings === undefined || head === undefined) return;
    if (!sessionLoaded(head)) return;
    for (const entry of [...settings]) {
      if (!deps.sendToAgent(entry.frame)) break;
      settings.shift();
    }
    if (settings.length === 0) pendingSettings.delete(sessionId);
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
    const dropped = [
      ...(inFlight === undefined ? [] : [inFlight]),
      ...(queues.get(sessionId) ?? []),
    ];
    queues.delete(sessionId);
    if (dropped.length === 0) return;
    deps.onQueueChanged?.(sessionId);
    deps.onQueueDropped(sessionId, dropped, cause);
  }

  function sendToChannel(channel: ClientChannel, line: string): void {
    if (channel.isOpen()) channel.send(line);
  }

  function notifyAccepted(
    entry: PromptSubmission,
    queued: boolean,
    steered = false,
  ): void {
    if (entry.promptId === null) return;
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
      ((deps.toolsIdle?.(sessionId) ?? true) || waitedOut(entry)) &&
      deps.steer !== undefined &&
      activeTurns.has(sessionId) &&
      !steering.has(sessionId) &&
      (deps.canSteer?.(sessionId) ?? false) &&
      deps.canStart(entry)
    );
  }

  function beginSteer(entry: PromptSubmission): void {
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
    const queue = queues.get(sessionId);
    const head = queue?.[0];
    if (queue === undefined || head === undefined) return;
    if (canSteerNow(head)) {
      queue.shift();
      if (queue.length === 0) queues.delete(sessionId);
      deps.onQueueChanged?.(sessionId);
      beginSteer(head);
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
    if (outcome === "refused") {
      entry.steerRefused = true;
      enqueue(entry, true);
      notifyAccepted(entry, true);
      maybeStartNext(sessionId);
      return;
    }
    notifyAccepted(entry, false, true);
    const active = activeTurns.get(sessionId);
    active?.steered.push(entry);
    deps.onSteered?.(entry, active === undefined);
    if (active === undefined) maybeStartNext(sessionId);
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
    if (activeTurns.has(sessionId) || steering.has(sessionId)) return;
    const queue = queues.get(sessionId);
    const next = queue?.[0];
    if (queue === undefined || next === undefined) return;
    if (!deps.canStart(next)) return;
    queue.shift();
    if (!start(next)) {
      queue.unshift(next);
      return;
    }
    if (queue.length === 0) queues.delete(sessionId);
    deps.onQueueChanged?.(sessionId);
    steerFromQueue(sessionId);
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
      const sessionId = submission.sessionId;
      if (!queues.get(sessionId)?.length && canSteerNow(submission)) {
        beginSteer(submission);
        return "steering";
      }
      if (
        activeTurns.has(sessionId) ||
        steering.has(sessionId) ||
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
        sessionLoaded(submission) &&
        deps.sendToAgent(submission.frame)
      )
        return "started";
      pendingSettings.set(sessionId, [
        ...(pendingSettings.get(sessionId) ?? []),
        submission,
      ]);
      return "queued";
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
      if (queues.get(sessionId)?.length) maybeStartNext(sessionId);
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
        pendingSettings.has(sessionId)
      );
    },

    anyWork() {
      return (
        activeTurns.size > 0 ||
        steering.size > 0 ||
        queues.size > 0 ||
        pendingSettings.size > 0
      );
    },

    activeTurnCount() {
      return activeTurns.size;
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
      for (const entry of queue) refuse(entry, message);
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

    onToolsIdle(sessionId) {
      steerFromQueue(sessionId);
    },

    snapshot(sessionId) {
      return (queues.get(sessionId) ?? []).map((entry) => ({
        promptId: entry.promptId,
        blocks: entry.blocks ?? [],
        queuedAt: entry.queuedAt ?? "",
        editable: entry.editable === true && entry.promptId !== null,
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
      dropQueue(sessionId, "session-forgotten");
      if (active !== undefined) {
        deps.onTurnInterrupted?.(sessionId, active);
        deps.onTurnEnded?.(sessionId);
      }
    },

    clear() {
      for (const timer of parkTimers.values()) clearTimeout(timer);
      parkTimers.clear();
      for (const timer of steerTimers.values()) clearTimeout(timer);
      steerTimers.clear();
      for (const sessionId of [...pendingSettings.keys()])
        refuseSettings(
          sessionId,
          "the setting was not applied: the harness went down",
        );
      const active = [...activeTurns.entries()];
      activeTurns.clear();
      for (const sessionId of new Set([...queues.keys(), ...steering.keys()]))
        dropQueue(sessionId, "scheduler-cleared");
      for (const [sessionId, turn] of active) {
        deps.onTurnInterrupted?.(sessionId, turn);
        deps.onTurnEnded?.(sessionId);
      }
    },
  };
}
