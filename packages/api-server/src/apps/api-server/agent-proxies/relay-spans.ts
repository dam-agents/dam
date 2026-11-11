import {
  trace,
  SpanKind,
  SpanStatusCode,
  type Link,
  type Span,
} from "@opentelemetry/api";

import type { HoldEnd, HoldStart } from "./ready-or-answering.js";

const SCOPE = "platform-apiserver";
const MAX_WATCHED_FRAME_BYTES = 64 * 1024;
const MAX_PENDING = 32;
const HEAD_CHARS = 200;
const ANSWER_HEAD =
  /^\{(?:"jsonrpc":"2\.0",)?"id":(\d+|"[^"]*")(?:,"jsonrpc":"2\.0")?,"(result|error)":/;

export type HoldOutcome = HoldEnd | "failed" | "refused" | "gone";

export interface RelayHoldSpan {
  end(outcome: HoldOutcome, err?: unknown): void;
  link(): Link[];
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the span of one relay hold: how long a socket
 * waited for its agent, what the agent was when the wait began, and how the
 * wait ended — Ready, the agent's health answer, a failed wake, a refusal, or
 * a client that left. It is a root of its own, since the upgrade that opened
 * the socket has already been answered. Its attributes follow the counters'
 * rule: no agent, owner or session id, only bounded values.
 */
export function startHoldSpan(relay: string, start: HoldStart): RelayHoldSpan {
  const span = trace.getTracer(SCOPE).startSpan("relay.hold", {
    kind: SpanKind.INTERNAL,
    root: true,
    attributes: {
      "platform.relay": relay,
      "platform.relay.hold.start": start,
    },
  });
  let ended = false;
  return {
    end(outcome, err) {
      if (ended) return;
      ended = true;
      span.setAttribute("platform.relay.hold.end", outcome);
      if (outcome === "failed") {
        span.setStatus({ code: SpanStatusCode.ERROR });
        span.setAttribute(
          "error.type",
          err instanceof Error ? err.name : "unknown",
        );
      }
      span.end();
    },
    link() {
      return [{ context: span.spanContext() }];
    },
  };
}

export type WatchedMethod = (frame: unknown) => string | null;

interface Pending {
  span: Span;
}

function idOf(frame: unknown): string | null {
  if (typeof frame !== "object" || frame === null) return null;
  const id = (frame as { id?: unknown }).id;
  return typeof id === "string" || typeof id === "number" ? String(id) : null;
}

function parse(data: Buffer | string): unknown {
  try {
    return JSON.parse(typeof data === "string" ? data : data.toString("utf8"));
  } catch {
    return null;
  }
}

export interface RequestSpans {
  sent(data: Buffer | string, queuedMs: number): void;
  answered(data: Buffer | string): void;
  close(): void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: spans for the requests a relay forwards whose
 * answer time decides how fast a session opens — a `session/load` on the ACP
 * relay, the transcript tail read on the agent's tRPC relay. A span starts
 * when the frame goes to the agent and ends with the agent's answer of the
 * same id, so its length is the agent's answer time; how long the frame
 * waited for the hold first is an attribute, and the span links to that
 * hold. Only small text frames are read for a request, and the agent's
 * frames only while one is open. An answer is told by its head alone, the id and whether
 * it is a result or an error, so a large answer is never parsed here. A
 * socket that closes first ends its open spans as unanswered.
 */
export function createRequestSpans(
  relay: string,
  watched: WatchedMethod,
  links: () => Link[] = () => [],
): RequestSpans {
  const pending = new Map<string, Pending>();
  const tracer = trace.getTracer(SCOPE);
  const finish = (entry: Pending, outcome: string) => {
    entry.span.setAttribute("platform.relay.request.outcome", outcome);
    if (outcome !== "ok") entry.span.setStatus({ code: SpanStatusCode.ERROR });
    entry.span.end();
  };
  const each = (frame: unknown, fn: (one: unknown) => void) => {
    if (Array.isArray(frame)) for (const one of frame) fn(one);
    else fn(frame);
  };
  return {
    sent(data, queuedMs) {
      if (data.length > MAX_WATCHED_FRAME_BYTES) return;
      each(parse(data), (frame) => {
        const method = watched(frame);
        const id = idOf(frame);
        if (method === null || id === null || pending.size >= MAX_PENDING)
          return;
        const span = tracer.startSpan("relay.request", {
          kind: SpanKind.CLIENT,
          root: true,
          links: links(),
          attributes: {
            "platform.relay": relay,
            "rpc.method": method,
            "platform.relay.queued_ms": Math.round(queuedMs),
          },
        });
        pending.get(id)?.span.end();
        pending.set(id, { span });
      });
    },
    answered(data) {
      if (pending.size === 0) return;
      const head =
        typeof data === "string"
          ? data.slice(0, HEAD_CHARS)
          : data.toString("utf8", 0, HEAD_CHARS);
      const answer = ANSWER_HEAD.exec(head);
      if (!answer) return;
      const id = answer[1]!.replace(/^"|"$/g, "");
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      finish(entry, answer[2] === "error" ? "error" : "ok");
    },
    close() {
      for (const entry of pending.values()) finish(entry, "unanswered");
      pending.clear();
    },
  };
}
