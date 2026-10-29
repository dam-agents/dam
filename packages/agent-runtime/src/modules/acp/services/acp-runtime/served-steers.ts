import {
  PROMPT_QUEUE_FULL_CODE,
  PROMPT_QUEUE_FULL_MESSAGE,
  type JsonRpcId,
} from "api-server-api";
import { match } from "ts-pattern";

import type { ClientChannel } from "../../infrastructure/client-channel.js";
import type { SteerOnlyAnswer } from "./prompt-scheduler.js";

const ANSWERS_KEPT_PER_SESSION = 64;

interface Waiter {
  channel: ClientChannel;
  id: JsonRpcId;
}

interface ServedSteer {
  answer: SteerOnlyAnswer | null;
  waiters: Waiter[];
}

export interface ServedSteers {
  replyKnown(sessionId: string, promptId: string, waiter: Waiter): boolean;
  join(sessionId: string, promptId: string, waiter: Waiter): boolean;
  settle(sessionId: string, promptId: string, answer: SteerOnlyAnswer): void;
  drop(sessionId: string, promptId: string): void;
  forget(sessionId: string): void;
}

function replyOf(id: JsonRpcId, answer: SteerOnlyAnswer): object {
  return match(answer)
    .with("injected", () => ({
      jsonrpc: "2.0",
      id,
      result: { outcome: "injected" },
    }))
    .with("noRunningTurn", "notYourTurn", (reason) => ({
      jsonrpc: "2.0",
      id,
      result: { outcome: "promptRequired", reason },
    }))
    .with("queueFull", () => ({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32000,
        message: PROMPT_QUEUE_FULL_MESSAGE,
        data: { code: PROMPT_QUEUE_FULL_CODE },
      },
    }))
    .exhaustive((unexpected) => ({
      jsonrpc: "2.0",
      id,
      error: { code: -32603, message: `unknown steer answer ${unexpected}` },
    }));
}

function reply(waiter: Waiter, answer: SteerOnlyAnswer): void {
  if (waiter.channel.isOpen())
    waiter.channel.send(JSON.stringify(replyOf(waiter.id, answer)));
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: remembers each `_session/steering` request the
 * runtime serves, by the sender-minted promptId of its steer batch, so a
 * request sent again after a lost connection joins the first one instead of
 * reaching the agent a second time. A steer still waiting gains the new
 * request as one more waiter; an answered one is answered again with its first
 * answer. Every waiter of a steer gets the same answer. Only the newest
 * answers of a session are kept, because a sender repeats a steer within
 * moments, never after many later ones. One instance serves the lease router
 * and every lease, so a steer sent again after its turn ended gets its answer
 * from the router, which answers it without a harness.
 */
export function createServedSteers(): ServedSteers {
  const steers = new Map<string, Map<string, ServedSteer>>();

  function keepNewest(served: Map<string, ServedSteer>): void {
    const answered = [...served].filter(([, steer]) => steer.answer !== null);
    for (const [promptId] of answered.slice(
      0,
      Math.max(0, answered.length - ANSWERS_KEPT_PER_SESSION),
    ))
      served.delete(promptId);
  }

  return {
    replyKnown(sessionId, promptId, waiter) {
      const answer = steers.get(sessionId)?.get(promptId)?.answer;
      if (answer === undefined || answer === null) return false;
      reply(waiter, answer);
      return true;
    },

    join(sessionId, promptId, waiter) {
      const served = steers.get(sessionId) ?? new Map<string, ServedSteer>();
      steers.set(sessionId, served);
      const known = served.get(promptId);
      if (known === undefined) {
        served.set(promptId, { answer: null, waiters: [waiter] });
        return false;
      }
      if (known.answer === null) known.waiters.push(waiter);
      else reply(waiter, known.answer);
      return true;
    },

    settle(sessionId, promptId, answer) {
      const served = steers.get(sessionId);
      const steer = served?.get(promptId);
      if (served === undefined || steer === undefined || steer.answer !== null)
        return;
      steer.answer = answer;
      for (const waiter of steer.waiters.splice(0)) reply(waiter, answer);
      keepNewest(served);
    },

    drop(sessionId, promptId) {
      steers.get(sessionId)?.delete(promptId);
    },

    forget(sessionId) {
      steers.delete(sessionId);
    },
  };
}
