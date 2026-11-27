import type { JsonRpcId, JsonRpcResponse } from "api-server-api";
import {
  approvalToolCallIdOf,
  isPermissionRequest,
} from "../../domain/attribution.js";
import { rewriteAuthError } from "../../domain/mappers.js";
import type { ClientChannel } from "../../infrastructure/client-channel.js";

interface PendingRequest {
  sessionId: string | null;
  line: string;
  unwatched: boolean;
  permission: boolean;
}

interface ExpiryTimer {
  timer: ReturnType<typeof setTimeout>;
  at: number;
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
  permissionTtlMs(): number;
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
  waiting(
    id: JsonRpcId,
    sessionId: string,
    line: string,
    deadline?: number,
  ): void;
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
 * cleanly. A permission request waits a TTL of its own, as long as the
 * platform holds a request for the owner, so the owner can answer it from
 * elsewhere; every other request keeps the short one, because its expiry
 * also lets the lease recycle. A request with no session broadcasts to every
 * channel and never expires. Forgetting a session drops its requests the
 * same way, because the session id is reused after a reset: a question left
 * open must not follow that id into the next conversation, and must not keep
 * the runtime busy. The observer hears of every held request, of the first
 * moment no channel can answer it, with the time it will expire — so the
 * platform can record it while nobody watches the session — and of how each
 * request ended, answered or dropped. The end matters even for a request a
 * client mirrored itself: the platform settles its record on the answer the
 * runtime accepted, whoever wrote the record. When the runtime cancels a
 * turn itself, no client cancels the session's open tool call approvals, so
 * the runtime answers them as cancelled.
 */
export function createPendingAgentRequests(
  deps: PendingAgentRequestsDeps,
): PendingAgentRequests {
  const pending = new Map<JsonRpcId, PendingRequest>();
  const expiryTimers = new Map<string, ExpiryTimer>();

  function timerKey(sessionId: string, permission: boolean): string {
    return `${permission ? "permission" : "other"}\u0000${sessionId}`;
  }

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

  function hasOf(sessionId: string, permission: boolean): boolean {
    for (const req of pending.values()) {
      if (req.sessionId === sessionId && req.permission === permission)
        return true;
    }
    return false;
  }

  function clearExpiryTimer(key: string): void {
    const existing = expiryTimers.get(key);
    if (!existing) return;
    clearTimeout(existing.timer);
    expiryTimers.delete(key);
  }

  function clearExpiryTimers(sessionId: string): void {
    clearExpiryTimer(timerKey(sessionId, false));
    clearExpiryTimer(timerKey(sessionId, true));
  }

  function announceUnwatched(sessionId: string): void {
    for (const [id, req] of pending) {
      if (req.sessionId !== sessionId || req.unwatched) continue;
      const timer = expiryTimers.get(timerKey(sessionId, req.permission));
      if (!timer) continue;
      req.unwatched = true;
      deps.observer.waiting(id, sessionId, req.line, timer.at);
    }
  }

  function abandoned(id: JsonRpcId, req: PendingRequest): void {
    if (req.sessionId !== null) deps.observer.abandoned(id, req.sessionId);
  }

  function updateExpiryTimer(sessionId: string): void {
    const unwatched = !hasOpenChannel(sessionId);
    for (const permission of [false, true]) {
      const key = timerKey(sessionId, permission);
      if (!unwatched || !hasOf(sessionId, permission)) {
        clearExpiryTimer(key);
        continue;
      }
      if (expiryTimers.has(key)) continue;
      const ttl = permission ? deps.permissionTtlMs() : deps.orphanTtlMs;
      expiryTimers.set(key, {
        timer: setTimeout(() => expire(sessionId, permission), ttl),
        at: Date.now() + ttl,
      });
    }
    if (unwatched) announceUnwatched(sessionId);
  }

  function abortRequestsOf(
    sessionId: string,
    message: string,
    permission?: boolean,
  ): number {
    const aborted: [JsonRpcId, PendingRequest][] = [];
    for (const [id, req] of pending) {
      if (
        req.sessionId === sessionId &&
        (permission === undefined || req.permission === permission)
      )
        aborted.push([id, req]);
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

  function expire(sessionId: string, permission: boolean): void {
    expiryTimers.delete(timerKey(sessionId, permission));
    const expired = abortRequestsOf(
      sessionId,
      "Permission request expired: no client connected",
      permission,
    );
    if (expired > 0) deps.onExpired();
  }

  return {
    onAgentRequest(id, sessionId, line) {
      pending.set(id, {
        sessionId,
        line,
        unwatched: false,
        permission: isPermissionRequest(line),
      });
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
      clearExpiryTimers(sessionId);
      abortRequestsOf(sessionId, "Permission request cancelled: session reset");
    },

    clear() {
      for (const [id, req] of pending) abandoned(id, req);
      pending.clear();
      for (const t of expiryTimers.values()) clearTimeout(t.timer);
      expiryTimers.clear();
    },
  };
}
