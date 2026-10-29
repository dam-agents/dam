import { randomUUID } from "node:crypto";

import {
  isNonNullObject,
  resultOf,
  sessionUpdateOf,
  type JsonRpcId,
} from "api-server-api";

import type { ClientChannel } from "../../infrastructure/client-channel.js";

import { turnContinuedNotice } from "../interrupted-turn-recovery.js";
import type { PromptSubmission, SteerOutcome } from "./prompt-scheduler.js";

const CONTINUATION_RETRIES = 3;
const CONTINUATION_BACKOFF_MS = 250;

export interface ClientOfTurn {
  channel: ClientChannel | null;
  originalId: JsonRpcId | null;
}

export interface InterruptSteersDeps {
  sendToHarness(frame: unknown): boolean;
  nextOutboundId(): number;
  continueTurn(
    sessionId: string,
    outboundId: number,
    client: ClientOfTurn,
  ): void;
  resolveSteer(sessionId: string, outcome: SteerOutcome): void;
  openToolCalls(sessionId: string): string[];
  cancelApprovals(sessionId: string): string[];
  closeCutToolCalls(sessionId: string, toolCallIds: string[]): void;
  rememberUndelivered(sessionId: string, id: string, frame: unknown): void;
  forgetUndelivered(sessionId: string, id: string): void;
  log(msg: string): void;
}

export interface InterruptSteers {
  steer(
    entry: PromptSubmission,
    batch: PromptSubmission[],
  ): Promise<SteerOutcome>;
  onClientCancel(sessionId: string): void;
  onTurnStarted(sessionId: string): void;
  consumePromptAnswer(
    sessionId: string,
    outboundId: number,
    client: ClientOfTurn,
    frame: unknown,
  ): boolean;
  onSessionUpdate(sessionId: string, frame: unknown): void;
  clear(): void;
}

interface Interrupt {
  sessionId: string;
  prompt: unknown[];
  phase: "cancelling" | "continuing";
  undeliveredId: string | null;
  cutToolCalls: string[];
  client: ClientOfTurn | null;
  continuationId: number | null;
  retries: number;
  resolve: (outcome: SteerOutcome) => void;
}

function promptOf(entry: PromptSubmission): unknown[] {
  const prompt = (entry.frame as { params?: { prompt?: unknown } }).params
    ?.prompt;
  return Array.isArray(prompt) ? prompt : [];
}

function stopReasonOf(frame: unknown): string | null {
  const reason = resultOf(frame)?.stopReason;
  return typeof reason === "string" ? reason : null;
}

const CONTINUED_TURN_UPDATES = new Set([
  "user_message_chunk",
  "agent_message_chunk",
  "agent_thought_chunk",
  "tool_call",
  "plan",
]);

function continuesTurn(frame: unknown): boolean {
  const kind = sessionUpdateOf(frame)?.sessionUpdate;
  return typeof kind === "string" && CONTINUED_TURN_UPDATES.has(kind);
}

function failed(frame: unknown): boolean {
  return isNonNullObject(frame) && frame.error !== undefined;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: steers a harness that cannot take a message into
 * its running turn (interrupt and continue). At a steer point it cancels the
 * harness's turn and, once the harness answers cancelled, sends the waiting
 * messages as a new prompt followed by the turn-continued notice. As the client
 * of a cancelled turn must, it answers the session's open tool call approvals
 * as cancelled, and it closes every tool call the cancel cut, so the notice
 * tells the agent to check what such a call left. For every client this stays
 * one turn: the turn keeps its prompt id and moves to the new harness prompt,
 * whose answer answers the client. Only the harness's answer to the new prompt
 * or its first output for it proves that the harness took it; a late frame of
 * the cancelled prompt proves nothing. Until then nothing that reacts to a
 * turn's end runs. A cancel cannot be undone, so every way the gap can end
 * delivers the messages once: the turn ending on its own or a person's Stop
 * before the harness answers the cancel gives the steer back as refused; once
 * the harness has the new prompt, the messages are delivered, also when a
 * person's Stop then ends the turn, and a Stop while the runtime waits to ask
 * again cancels the new prompt as soon as it is sent; a harness that refuses
 * the new prompt is asked a few more times; and the batch is recorded as
 * undelivered until the harness takes it, so a crash in the gap leaves it for
 * the person to send again.
 */
export function createInterruptSteers(
  deps: InterruptSteersDeps,
): InterruptSteers {
  const interrupts = new Map<string, Interrupt>();
  const cancelledByClient = new Set<string>();

  function finish(it: Interrupt, outcome: SteerOutcome): void {
    if (interrupts.get(it.sessionId) !== it) return;
    interrupts.delete(it.sessionId);
    if (it.undeliveredId !== null)
      deps.forgetUndelivered(it.sessionId, it.undeliveredId);
    deps.resolveSteer(it.sessionId, outcome);
    it.resolve(outcome);
  }

  function sendContinuation(it: Interrupt): void {
    if (interrupts.get(it.sessionId) !== it || it.client === null) return;
    const outboundId = deps.nextOutboundId();
    const sent = deps.sendToHarness({
      jsonrpc: "2.0",
      id: outboundId,
      method: "session/prompt",
      params: {
        sessionId: it.sessionId,
        prompt: [
          ...it.prompt,
          {
            type: "text",
            text: turnContinuedNotice(it.cutToolCalls.length > 0),
          },
        ],
      },
    });
    if (!sent) {
      deps.log(`interrupt steer for ${it.sessionId}: the harness is gone`);
      finish(it, "refused");
      return;
    }
    it.phase = "continuing";
    it.continuationId = outboundId;
    deps.continueTurn(it.sessionId, outboundId, it.client);
    if (cancelledByClient.has(it.sessionId))
      deps.sendToHarness({
        jsonrpc: "2.0",
        method: "session/cancel",
        params: { sessionId: it.sessionId },
      });
  }

  return {
    steer(entry, batch) {
      const sessionId = entry.sessionId;
      if (cancelledByClient.has(sessionId) || interrupts.has(sessionId))
        return Promise.resolve("refused");
      const ordinary = batch.filter((member) => member.steerOnly === undefined);
      const undeliveredId =
        ordinary.length === 0 ? null : (entry.promptId ?? randomUUID());
      if (undeliveredId !== null)
        deps.rememberUndelivered(sessionId, undeliveredId, {
          ...(entry.frame as object),
          params: { sessionId, prompt: ordinary.flatMap(promptOf) },
        });
      return new Promise<SteerOutcome>((resolve) => {
        const it: Interrupt = {
          sessionId,
          prompt: promptOf(entry),
          phase: "cancelling",
          undeliveredId,
          cutToolCalls: deps.openToolCalls(sessionId),
          client: null,
          continuationId: null,
          retries: 0,
          resolve,
        };
        interrupts.set(sessionId, it);
        if (
          !deps.sendToHarness({
            jsonrpc: "2.0",
            method: "session/cancel",
            params: { sessionId },
          })
        ) {
          finish(it, "refused");
          return;
        }
        for (const toolCallId of deps.cancelApprovals(sessionId))
          if (!it.cutToolCalls.includes(toolCallId))
            it.cutToolCalls.push(toolCallId);
      });
    },

    onClientCancel(sessionId) {
      cancelledByClient.add(sessionId);
    },

    onTurnStarted(sessionId) {
      cancelledByClient.delete(sessionId);
    },

    consumePromptAnswer(sessionId, outboundId, client, frame) {
      const it = interrupts.get(sessionId);
      if (it === undefined) return false;
      if (it.phase === "cancelling") {
        if (
          stopReasonOf(frame) !== "cancelled" ||
          cancelledByClient.has(sessionId)
        ) {
          finish(it, "refused");
          return false;
        }
        it.client = client;
        deps.closeCutToolCalls(sessionId, it.cutToolCalls);
        sendContinuation(it);
        return true;
      }
      if (outboundId !== it.continuationId) return false;
      if (
        failed(frame) &&
        it.retries < CONTINUATION_RETRIES &&
        !cancelledByClient.has(sessionId)
      ) {
        it.retries += 1;
        setTimeout(
          () => sendContinuation(it),
          CONTINUATION_BACKOFF_MS * 2 ** (it.retries - 1),
        );
        return true;
      }
      finish(it, failed(frame) ? "refused" : "injected");
      return false;
    },

    onSessionUpdate(sessionId, frame) {
      const it = interrupts.get(sessionId);
      if (it?.phase === "continuing" && continuesTurn(frame))
        finish(it, "injected");
    },

    clear() {
      for (const it of interrupts.values()) {
        if (it.undeliveredId !== null)
          deps.forgetUndelivered(it.sessionId, it.undeliveredId);
        it.resolve("refused");
      }
      interrupts.clear();
      cancelledByClient.clear();
    },
  };
}
