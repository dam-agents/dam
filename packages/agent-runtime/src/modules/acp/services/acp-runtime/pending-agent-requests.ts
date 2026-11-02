import type { JsonRpcId, JsonRpcResponse } from "api-server-api";
import { approvalToolCallIdOf } from "../../domain/attribution.js";
import { rewriteAuthError } from "../../domain/mappers.js";
import type { ClientChannel } from "../../infrastructure/client-channel.js";

interface PendingRequest {
  sessionId: string | null;
  line: string;
  unwatched: boolean;
}

export interface PendingAgentRequests {
  onAgentRequest(id: JsonRpcId, sessionId: string | null, line: string): void;
  answer(frame: JsonRpcResponse): AnsweredRequest | null;
  onEngaged(channel: ClientChannel, sessionId: string): void;
  reassess(sessionId: string): void;
  cancelApprovals(sessionId: string): string[];
  hasFor(sessionId: string): boolean;
  any(): boolean;
  size(): number;
  forget(sessionId: string): void;
  clear(): void;
}

export interface AnsweredRequest {
  sessionId: string | null;
  line: string;
}

export interface PendingAgentRequestsDeps {
  orphanTtlMs: number;
  channelsFor(sessionId: string | null): Iterable<ClientChannel>;
  sendToAgent(frame: unknown): void;
  onExpired(): void;
  observer: AgentRequestObserver;
}

export const noopAgentRequests: AgentRequestObserver = {
  held: () => {},
  waiting: () => {},
  answered: () => {},
  abandoned: () => {},
};

export interface AgentRequestObserver {
  held(id: JsonRpcId, sessionId: string, line: string): void;
  waiting(id: JsonRpcId, sessionId: string, line: string): void;
  answered(id: JsonRpcId, sessionId: string, result: unknown): void;
  abandoned(id: JsonRpcId, sessionId: string): void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Holds each agent-initiated request (typically a
 * permission prompt) open until a client answers. A new request fans out to
 * the session's engaged channels; a channel that engages later is asked
 * again on arrival; the first answer wins and later answers are dropped. A
 * session-scoped request with no engaged channel expires after a TTL,
 * answering the agent with a structured error so the tool call aborts
 * cleanly. A request with no session broadcasts to every channel and never
 * expires. Forgetting a session drops its requests the same way, because the
 * session id is reused after a reset: a question left open must not follow
 * that id into the next conversation, and must not keep the runtime busy.
 * The observer hears of every held request, of the first moment no channel
 * can answer it — so the platform can record it while nobody watches the
 * session — and of how each request ended, answered or dropped. The end
 * matters even for a request a client mirrored itself: the platform settles
 * its record on the answer the runtime accepted, whoever wrote the record.
 * When the runtime cancels a turn itself, no client cancels the session's
 * open tool call approvals, so the runtime answers them as cancelled.
 */
export function createPendingAgentRequests(
  deps: PendingAgentRequestsDeps,
): PendingAgentRequests {
  const pending = new Map<JsonRpcId, PendingRequest>();
  const expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function hasOpenChannel(sessionId: string): boolean {
    for (const channel of deps.channelsFor(sessionId)) {
      if (channel.isOpen()) return true;
    }
    return false;
  }

  function hasFor(sessionId: string): boolean {
    for (const req of pending.values()) {
      if (req.sessionId === sessionId) return true;
    }
    return false;
  }

  function clearExpiryTimer(sessionId: string): void {
    const existing = expiryTimers.get(sessionId);
    if (!existing) return;
    clearTimeout(existing);
    expiryTimers.delete(sessionId);
  }

  function announceUnwatched(sessionId: string): void {
    for (const [id, req] of pending) {
      if (req.sessionId !== sessionId || req.unwatched) continue;
      req.unwatched = true;
      deps.observer.waiting(id, sessionId, req.line);
    }
  }

  function abandoned(id: JsonRpcId, req: PendingRequest): void {
    if (req.sessionId !== null) deps.observer.abandoned(id, req.sessionId);
  }

  function updateExpiryTimer(sessionId: string): void {
    const shouldRun = hasFor(sessionId) && !hasOpenChannel(sessionId);
    if (shouldRun) announceUnwatched(sessionId);
    if (shouldRun && !expiryTimers.get(sessionId)) {
      expiryTimers.set(
        sessionId,
        setTimeout(() => expire(sessionId), deps.orphanTtlMs),
      );
    } else if (!shouldRun) {
      clearExpiryTimer(sessionId);
    }
  }

  function abortRequestsOf(sessionId: string, message: string): number {
    const aborted: [JsonRpcId, PendingRequest][] = [];
    for (const [id, req] of pending) {
      if (req.sessionId === sessionId) aborted.push([id, req]);
    }
    for (const [id, req] of aborted) {
      pending.delete(id);
      deps.sendToAgent({
        jsonrpc: "2.0",
        id,
        error: { code: -32000, message },
      });
      abandoned(id, req);
    }
    return aborted.length;
  }

  function expire(sessionId: string): void {
    expiryTimers.delete(sessionId);
    const expired = abortRequestsOf(
      sessionId,
      "Permission request expired: no client connected",
    );
    if (expired > 0) deps.onExpired();
  }

  return {
    onAgentRequest(id, sessionId, line) {
      pending.set(id, { sessionId, line, unwatched: false });
      if (sessionId !== null) deps.observer.held(id, sessionId, line);
      const out = rewriteAuthError(line);
      for (const channel of deps.channelsFor(sessionId)) {
        if (channel.isOpen()) channel.send(out);
      }
      if (sessionId !== null) updateExpiryTimer(sessionId);
    },

    answer(frame) {
      const req = pending.get(frame.id);
      if (!req) return null;
      pending.delete(frame.id);
      if (req.sessionId !== null) updateExpiryTimer(req.sessionId);
      deps.sendToAgent(frame);
      if (req.sessionId !== null)
        deps.observer.answered(frame.id, req.sessionId, frame.result);
      return { sessionId: req.sessionId, line: req.line };
    },

    onEngaged(channel, sessionId) {
      for (const req of pending.values()) {
        if (req.sessionId === sessionId && channel.isOpen()) {
          channel.send(rewriteAuthError(req.line));
        }
      }
      updateExpiryTimer(sessionId);
    },

    reassess(sessionId) {
      updateExpiryTimer(sessionId);
    },

    cancelApprovals(sessionId) {
      const toolCallIds: string[] = [];
      for (const [id, req] of [...pending]) {
        if (req.sessionId !== sessionId) continue;
        const toolCallId = approvalToolCallIdOf(req.line);
        if (toolCallId === null) continue;
        pending.delete(id);
        const result = { outcome: { outcome: "cancelled" } };
        deps.sendToAgent({ jsonrpc: "2.0", id, result });
        deps.observer.answered(id, sessionId, result);
        toolCallIds.push(toolCallId);
      }
      updateExpiryTimer(sessionId);
      return toolCallIds;
    },

    hasFor,

    any() {
      return pending.size > 0;
    },

    size() {
      return pending.size;
    },

    forget(sessionId) {
      clearExpiryTimer(sessionId);
      abortRequestsOf(sessionId, "Permission request cancelled: session reset");
    },

    clear() {
      for (const [id, req] of pending) abandoned(id, req);
      pending.clear();
      for (const t of expiryTimers.values()) clearTimeout(t);
      expiryTimers.clear();
    },
  };
}
