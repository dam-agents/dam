import {
  buildPlatformPromptAcceptedNotification,
  buildPlatformPromptStartedNotification,
  PROMPT_QUEUE_FULL_CODE,
  PROMPT_QUEUE_FULL_MESSAGE,
} from "api-server-api";

import { randomUUID } from "node:crypto";

import type { JsonRpcId } from "../../domain/frames.js";
import type { ClientChannel } from "../../infrastructure/client-channel.js";

const PROMPT_QUEUE_CAP = 32;
const DEFAULT_QUEUE_PARK_MS = 90 * 1000;

export type PromptFate = "started" | "queued" | "refused";

export type QueueDropCause =
  "park-expired" | "session-forgotten" | "scheduler-cleared";

export interface PromptSubmission {
  sessionId: string;
  channel: ClientChannel;
  outboundId: number;
  originalId: JsonRpcId;
  frame: unknown;
  promptId: string | null;
  runPrompt?: boolean;
  unattended?: boolean;
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
  onTurnEnded?: (sessionId: string) => void;
  onTurnInterrupted?: (
    sessionId: string,
    turn: { promptId: string | null; runPrompt: boolean },
  ) => void;
  queueParkMs?: number;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Runs each session one turn at a time. A prompt
 * submitted while a turn is in flight is queued (up to a cap, then refused
 * with a structured error) and promoted when the turn ahead of it ends. The
 * scheduler tells the sender each prompt's fate itself — accepted, queued,
 * started — over the sender's own channel, and answers the runtime's
 * busy/idle questions about turn state.
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
    }
  >();
  const queues = new Map<string, PromptSubmission[]>();
  const pendingSettings = new Map<string, PromptSubmission[]>();
  const parkTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const queueParkMs = deps.queueParkMs ?? DEFAULT_QUEUE_PARK_MS;

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
    refuseSettings(
      sessionId,
      `the setting was not applied: the session's queue was dropped (${cause})`,
    );
    clearParkTimer(sessionId);
    const dropped = queues.get(sessionId);
    queues.delete(sessionId);
    if (dropped === undefined || dropped.length === 0) return;
    deps.onQueueDropped(sessionId, dropped, cause);
  }

  function sendToChannel(channel: ClientChannel, line: string): void {
    if (channel.isOpen()) channel.send(line);
  }

  function notifyAccepted(entry: PromptSubmission, queued: boolean): void {
    if (entry.promptId === null) return;
    sendToChannel(
      entry.channel,
      JSON.stringify(
        buildPlatformPromptAcceptedNotification({
          sessionId: entry.sessionId,
          promptId: entry.promptId,
          queued,
        }),
      ),
    );
  }

  function start(entry: PromptSubmission): boolean {
    if (!deps.sendToAgent(entry.frame)) return false;
    clearParkTimer(entry.sessionId);
    activeTurns.set(entry.sessionId, {
      outboundId: entry.outboundId,
      promptId: entry.promptId,
      turnId: entry.promptId ?? randomUUID(),
      runPrompt: entry.runPrompt ?? false,
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
    if (activeTurns.has(sessionId)) return;
    const queue = queues.get(sessionId);
    const next = queue?.[0];
    if (queue === undefined || next === undefined) return;
    if (!deps.canStart(next)) return;
    if (!start(next)) return;
    queue.shift();
    if (queue.length === 0) queues.delete(sessionId);
  }

  function refuse(entry: PromptSubmission, message?: string): void {
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
      if (activeTurns.has(sessionId) || !deps.canStart(submission)) {
        const queue = queues.get(sessionId) ?? [];
        if (queue.length >= PROMPT_QUEUE_CAP) {
          refuse(submission);
          return "refused";
        }
        queue.push(submission);
        queues.set(sessionId, queue);
        notifyAccepted(submission, true);
        return "queued";
      }
      notifyAccepted(submission, false);
      if (start(submission)) return "started";
      queues.set(sessionId, [submission]);
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
        };
      }
      activeTurns.delete(sessionId);
      deps.onTurnEnded?.(sessionId);
      if (queues.get(sessionId)?.length) maybeStartNext(sessionId);
      else queues.delete(sessionId);
      return {
        turnEnded: true,
        promptId: active.promptId,
        turnId: active.turnId,
        runPrompt: active.runPrompt,
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
        queues.has(sessionId) ||
        pendingSettings.has(sessionId)
      );
    },

    anyWork() {
      return (
        activeTurns.size > 0 || queues.size > 0 || pendingSettings.size > 0
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
      refuseSettings(sessionId, message);
      const queue = queues.get(sessionId);
      if (queue === undefined) return;
      queues.delete(sessionId);
      clearParkTimer(sessionId);
      for (const entry of queue) refuse(entry, message);
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
      for (const sessionId of [...pendingSettings.keys()])
        refuseSettings(
          sessionId,
          "the setting was not applied: the harness went down",
        );
      const active = [...activeTurns.entries()];
      activeTurns.clear();
      for (const sessionId of [...queues.keys()])
        dropQueue(sessionId, "scheduler-cleared");
      for (const [sessionId, turn] of active) {
        deps.onTurnInterrupted?.(sessionId, turn);
        deps.onTurnEnded?.(sessionId);
      }
    },
  };
}
