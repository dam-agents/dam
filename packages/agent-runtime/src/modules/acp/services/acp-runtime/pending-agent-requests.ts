import type { JsonRpcId, JsonRpcResponse } from "../../domain/frames.js";
import { rewriteAuthError } from "../../domain/mappers.js";
import type { ClientChannel } from "../../infrastructure/client-channel.js";

interface PendingRequest {
  sessionId: string | null;
  line: string;
}

export interface PendingAgentRequests {
  onAgentRequest(id: JsonRpcId, sessionId: string | null, line: string): void;
  answer(frame: JsonRpcResponse): boolean;
  onEngaged(channel: ClientChannel, sessionId: string): void;
  reassess(sessionId: string): void;
  hasFor(sessionId: string): boolean;
  any(): boolean;
  size(): number;
  forget(sessionId: string): void;
  clear(): void;
}

export interface PendingAgentRequestsDeps {
  orphanTtlMs: number;
  channelsFor(sessionId: string | null): Iterable<ClientChannel>;
  sendToAgent(frame: unknown): void;
  onExpired(): void;
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

  function updateExpiryTimer(sessionId: string): void {
    const shouldRun = hasFor(sessionId) && !hasOpenChannel(sessionId);
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
    const aborted: JsonRpcId[] = [];
    for (const [id, req] of pending) {
      if (req.sessionId === sessionId) aborted.push(id);
    }
    for (const id of aborted) {
      pending.delete(id);
      deps.sendToAgent({
        jsonrpc: "2.0",
        id,
        error: { code: -32000, message },
      });
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
      pending.set(id, { sessionId, line });
      const out = rewriteAuthError(line);
      for (const channel of deps.channelsFor(sessionId)) {
        if (channel.isOpen()) channel.send(out);
      }
      if (sessionId !== null) updateExpiryTimer(sessionId);
    },

    answer(frame) {
      const req = pending.get(frame.id);
      if (!req) return false;
      pending.delete(frame.id);
      if (req.sessionId !== null) updateExpiryTimer(req.sessionId);
      deps.sendToAgent(frame);
      return true;
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
      pending.clear();
      for (const t of expiryTimers.values()) clearTimeout(t);
      expiryTimers.clear();
    },
  };
}
