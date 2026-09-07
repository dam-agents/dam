import {
  buildPlatformPromptAcceptedNotification,
  buildPlatformPromptStartedNotification,
  PROMPT_QUEUE_FULL_CODE,
  PROMPT_QUEUE_FULL_MESSAGE,
} from "api-server-api";

import type { JsonRpcId } from "../../domain/frames.js";
import type { ClientChannel } from "../../infrastructure/client-channel.js";

const PROMPT_QUEUE_CAP = 32;
const DEFAULT_QUEUE_PARK_MS = 90 * 1000;

export type PromptFate = "started" | "queued" | "refused";

export type QueueDropCause =
  | "park-expired"
  | "session-forgotten"
  | "scheduler-cleared";

export interface PromptSubmission {
  sessionId: string;
  channel: ClientChannel;
  outboundId: number;
  originalId: JsonRpcId;
  frame: unknown;
  promptId: string | null;
}

export interface PromptScheduler {
  submit(submission: PromptSubmission): PromptFate;
  onPromptResponse(
    sessionId: string,
    outboundId: number,
  ): { turnEnded: boolean };
  hasTurnInFlight(sessionId: string): boolean;
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
  canStart: (sessionId: string) => boolean;
  onQueueDropped: (
    sessionId: string,
    dropped: PromptSubmission[],
    cause: QueueDropCause,
  ) => void;
  onTurnStarted?: (submission: PromptSubmission) => void;
  onTurnEnded?: (sessionId: string) => void;
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
 * for the session to be loaded back into the harness. The last
 * channel leaving parks the queue rather than dropping it, so a page reload
 * keeps its place; a client that engages again within the park window resumes
 * the queue, and only when that window passes with nobody back is the queue
 * dropped. Every route a queue can leave by — that window expiring, the
 * session being forgotten, the scheduler being cleared when the harness goes
 * down — announces it over onQueueDropped with the cause, so a queue cannot
 * be discarded anywhere without its prompts being written down first. Nothing
 * outside this module ever removes a queue itself. refuseQueue is the one
 * exception and answers each sender with an error instead, so the loss is
 * reported to the client that is still there to hear it rather than recorded.
 */
export function createPromptScheduler(
  deps: PromptSchedulerDeps,
): PromptScheduler {
  const activeTurns = new Map<string, number>();
  const queues = new Map<string, PromptSubmission[]>();
  const parkTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const queueParkMs = deps.queueParkMs ?? DEFAULT_QUEUE_PARK_MS;

  function clearParkTimer(sessionId: string): void {
    const timer = parkTimers.get(sessionId);
    if (timer !== undefined) clearTimeout(timer);
    parkTimers.delete(sessionId);
  }

  function dropQueue(sessionId: string, cause: QueueDropCause): void {
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
    activeTurns.set(entry.sessionId, entry.outboundId);
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
    if (activeTurns.has(sessionId)) return;
    const queue = queues.get(sessionId);
    const next = queue?.[0];
    if (queue === undefined || next === undefined) return;
    if (!deps.canStart(sessionId)) return;
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
      if (activeTurns.has(sessionId) || !deps.canStart(sessionId)) {
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

    onPromptResponse(sessionId, outboundId) {
      if (activeTurns.get(sessionId) !== outboundId) {
        return { turnEnded: false };
      }
      activeTurns.delete(sessionId);
      deps.onTurnEnded?.(sessionId);
      if (queues.get(sessionId)?.length) maybeStartNext(sessionId);
      else queues.delete(sessionId);
      return { turnEnded: true };
    },

    hasTurnInFlight(sessionId) {
      return activeTurns.has(sessionId);
    },

    hasWork(sessionId) {
      return activeTurns.has(sessionId) || queues.has(sessionId);
    },

    anyWork() {
      return activeTurns.size > 0 || queues.size > 0;
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
      const queue = queues.get(sessionId);
      if (queue === undefined) return;
      queues.delete(sessionId);
      clearParkTimer(sessionId);
      for (const entry of queue) refuse(entry, message);
    },

    onDetached(sessionId) {
      if (!queues.has(sessionId)) return;
      if (deps.canStart(sessionId)) return;
      if (parkTimers.has(sessionId)) return;
      parkTimers.set(
        sessionId,
        setTimeout(() => dropQueue(sessionId, "park-expired"), queueParkMs),
      );
    },

    forget(sessionId) {
      const wasActive = activeTurns.delete(sessionId);
      dropQueue(sessionId, "session-forgotten");
      if (wasActive) deps.onTurnEnded?.(sessionId);
    },

    clear() {
      for (const timer of parkTimers.values()) clearTimeout(timer);
      parkTimers.clear();
      const active = [...activeTurns.keys()];
      activeTurns.clear();
      for (const sessionId of [...queues.keys()])
        dropQueue(sessionId, "scheduler-cleared");
      for (const sessionId of active) deps.onTurnEnded?.(sessionId);
    },
  };
}
