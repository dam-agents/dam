import {
  buildPlatformPromptAcceptedNotification,
  buildPlatformPromptStartedNotification,
  PROMPT_QUEUE_FULL_CODE,
  PROMPT_QUEUE_FULL_MESSAGE,
} from "api-server-api";

import type { JsonRpcId } from "../../domain/frames.js";
import type { ClientChannel } from "../../infrastructure/client-channel.js";

const PROMPT_QUEUE_CAP = 32;

export type PromptFate = "started" | "queued" | "refused";

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
  dropChannel(channel: ClientChannel): void;
  forget(sessionId: string): void;
  clear(): void;
}

export interface PromptSchedulerDeps {
  sendToAgent: (frame: unknown) => void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Runs each session one turn at a time. A prompt
 * submitted while a turn is in flight is queued (up to a cap, then refused
 * with a structured error) and promoted when the turn ahead of it ends. The
 * scheduler tells the sender each prompt's fate itself — accepted, queued,
 * started — over the sender's own channel, discards a leaver's queued
 * prompts, and answers the runtime's busy/idle questions about turn state.
 */
export function createPromptScheduler(
  deps: PromptSchedulerDeps,
): PromptScheduler {
  const activeTurns = new Map<string, number>();
  const queues = new Map<string, PromptSubmission[]>();

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

  function start(entry: PromptSubmission): void {
    activeTurns.set(entry.sessionId, entry.outboundId);
    deps.sendToAgent(entry.frame);
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
  }

  function refuse(entry: PromptSubmission): void {
    sendToChannel(
      entry.channel,
      JSON.stringify({
        jsonrpc: "2.0",
        id: entry.originalId,
        error: {
          code: -32000,
          message: `${PROMPT_QUEUE_FULL_MESSAGE} for session ${entry.sessionId}`,
          data: { code: PROMPT_QUEUE_FULL_CODE },
        },
      }),
    );
  }

  return {
    submit(submission) {
      if (activeTurns.has(submission.sessionId)) {
        const queue = queues.get(submission.sessionId) ?? [];
        if (queue.length >= PROMPT_QUEUE_CAP) {
          refuse(submission);
          return "refused";
        }
        queue.push(submission);
        queues.set(submission.sessionId, queue);
        notifyAccepted(submission, true);
        return "queued";
      }
      notifyAccepted(submission, false);
      start(submission);
      return "started";
    },

    onPromptResponse(sessionId, outboundId) {
      if (activeTurns.get(sessionId) !== outboundId) {
        return { turnEnded: false };
      }
      activeTurns.delete(sessionId);
      const queue = queues.get(sessionId);
      if (!queue || queue.length === 0) {
        queues.delete(sessionId);
        return { turnEnded: true };
      }
      const next = queue.shift()!;
      if (queue.length === 0) queues.delete(sessionId);
      start(next);
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

    dropChannel(channel) {
      for (const [sessionId, queue] of queues) {
        const kept = queue.filter((entry) => entry.channel !== channel);
        if (kept.length > 0) queues.set(sessionId, kept);
        else queues.delete(sessionId);
      }
    },

    forget(sessionId) {
      activeTurns.delete(sessionId);
      queues.delete(sessionId);
    },

    clear() {
      activeTurns.clear();
      queues.clear();
    },
  };
}
