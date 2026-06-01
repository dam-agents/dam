import { buildPlatformTurnEndedNotification } from "api-server-api";

import {
  isRequest,
  isResponse,
  parseFrame,
  type JsonRpcId,
} from "../domain/frames.js";
import type { AgentProcess } from "../infrastructure/agent-process.js";
import type { ClientChannel } from "../infrastructure/client-channel.js";
import { rewriteAuthError, rewriteCwd } from "../infrastructure/mappers.js";
import {
  platformSessionMetaSchema,
  type PlatformSessionMeta,
  type SessionMetaEntry,
  type SessionMetadataStore,
} from "../infrastructure/session-metadata-store.js";

/** Maximum prompts queued per session before we reject with an error. */
const PROMPT_QUEUE_CAP = 32;

/**
 * How long an agent→client request for a session can sit pending with no
 * channel engaged with that session before we give up and reject it back to
 * the agent. Keeps the buffer bounded on long-lived unattended sessions, and
 * gives the agent a clean error it can surface instead of hanging until
 * something inside its SDK times out.
 */
const DEFAULT_ORPHAN_TTL_MS = 10 * 60 * 1000;

/**
 * Soft cap on per-session log size. Once an append would push the log past
 * this, we drop the oldest entry and mark the log as `truncated` — future
 * catch-ups (session/load replays) prepend a `<clipped-conversation>`
 * sentinel so the UI can show that older history isn't available without a
 * forced full reload.
 */
const DEFAULT_LOG_BYTES_CAP = 2 * 1024 * 1024;

export interface AcpRuntimeStatus {
  activeClientCount: number;
  pendingRequestCount: number;
  queuedPromptCount: number;
  agentAlive: boolean;
}

export interface AcpRuntime {
  /**
   * Attach a channel. Multiple channels may be attached at once. Attachment
   * alone does not subscribe the channel to any session's traffic: a channel
   * only receives updates and agent-initiated requests for sessions it has
   * **engaged** with, where engagement is driven implicitly by ACP frames:
   *
   * - sending a request or notification with `params.sessionId`
   *   (prompt, load, resume, cancel, set_mode, ...) engages that session;
   * - receiving a response whose `result.sessionId` creates or identifies a
   *   session (new, fork, load, resume) engages it too.
   *
   * A cross-session call like `listSessions` carries no sessionId and never
   * engages — such channels can do their RPC round-trip without ever seeing
   * another session's permission prompts or updates.
   */
  attach(channel: ClientChannel): void;
  status(): AcpRuntimeStatus;
  resetSession(sessionId: string): void;
  shutdown(): void;
}

export interface AcpRuntimeDeps {
  spawnAgent: () => AgentProcess;
  workingDir: string;
  log?: (msg: string) => void;
  /** Override the orphan TTL — exposed for tests; production defaults to 10 min. */
  orphanTtlMs?: number;
  /** Override the log size cap — exposed for tests. */
  logBytesCap?: number;
  /** Owns the `_meta.platform.*` round-trip (ADR-055); skipped when omitted. */
  sessionMetadata?: SessionMetadataStore;
}

interface ActivePrompt {
  sessionId: string;
  outboundId: number;
  /** Null if the owning channel disconnected while the prompt was active. */
  channel: ClientChannel | null;
  originalId: JsonRpcId;
}

interface QueuedPrompt {
  channel: ClientChannel;
  outboundId: number;
  originalId: JsonRpcId;
  /** Rewritten frame ready to forward to the agent. */
  frame: unknown;
}

interface OutboundMapping {
  /** Channel that originated this outbound id. Null when the runtime itself
   * initiated the call (e.g. cold-resume translates to a runtime-issued
   * session/load with no client channel — the response just populates log
   * metadata, and any waiters are served by the bootstrap fan-out). */
  channel: ClientChannel | null;
  /** Original client id to echo back in the response. Null for runtime-
   * initiated calls (no client to respond to). */
  originalId: JsonRpcId | null;
  /** The method that originated this outbound id, so we can engage the channel
   * with a session returned in the response (e.g. `session/new` result). */
  method: string;
  /** Non-null when this outbound id was allocated for a session/prompt so the
   * queue advances when the response comes back. */
  promptSessionId: string | null;
  /** Session id this request attaches the channel to, when the method is
   * session-scoped but the response body doesn't echo the sid back
   * (session/load). Used to cache metadata on response and to fan out to
   * bootstrap waiters. */
  attachSessionId: string | null;
  /** Captured on `session/new`, applied once the response carries the sessionId. */
  platformMeta: PlatformSessionMeta | null;
}

interface PendingAgentRequest {
  /** The session this request is scoped to (from params.sessionId). Null
   * means the request has no session scope — rare but possible. */
  sessionId: string | null;
  frame: string;
}

interface LogEntry {
  /** Monotonic sequence within the session. Consumers tail by cursor > seq. */
  seq: number;
  /** The raw JSON-RPC line to send to consumers. */
  line: string;
  /** Approx byte cost — used for the soft cap. */
  bytes: number;
}

interface SessionLog {
  entries: LogEntry[];
  nextSeq: number;
  totalBytes: number;
  /** True once the soft cap has evicted at least one entry. */
  truncated: boolean;
  /** Cached `session/load` response metadata, captured from the first
   * (cold) bootstrap response. Used to synthesize responses to subsequent
   * `session/load` requests without forwarding to the agent.
   *
   * Invariant: `metadata !== null` means "the agent has this session live
   * and our log mirrors what it would replay." When `maybeCloseIdleSession`
   * tears the session down inside the agent, it MUST reset `metadata` to
   * null AND clear `entries`, so the next access goes through cold-bootstrap
   * and rehydrates both sides from disk.
   *
   * `null` represents two states: (a) the session was never bootstrapped, or
   * (b) the most recent cold `session/load` failed — the cache-population
   * guard in `handleAgentLine` skips writes when the agent's response has
   * `result === undefined` (i.e. an error frame), so an error leaves
   * `metadata` null. The bootstrap completion handler relies on exactly
   * this to detect cold-load failure (`loadFailed = log.metadata === null`)
   * and relay the agent's error to parked waiters. A future discriminated
   * union (`{ status: "loaded"; data: unknown } | null`) would let the
   * type system encode this directly. */
  metadata: unknown | null;
}

/**
 * A waiter parked on an in-flight cold bootstrap. The kind decides how it is
 * served once the bootstrap response lands:
 *   - "load"   → catchUp + synthetic session/load response (replays history).
 *   - "resume" → engage + synthetic session/resume response (no replay; the
 *                client already has history in its UI state from a prior
 *                throwaway session/load).
 */
type BootstrapWaiter =
  | { kind: "load"; channel: ClientChannel; originalId: JsonRpcId }
  | { kind: "resume"; channel: ClientChannel; originalId: JsonRpcId };

/**
 * Max-1-in-flight bootstrap state per session. A `session/load` request
 * received while a cold bootstrap is already running for the same sid is
 * not forwarded again — the bootstrap's agent response fills the log for
 * everyone, and the waiter is then served from memory.
 *
 * `initiatorChannel === null` means the runtime started the bootstrap itself
 * (cold-resume path). In that case replay events populate the log but reach
 * no client channel — every engaged channel's cursor advances silently, and
 * waiters are served on completion.
 */
interface BootstrapState {
  initiatorChannel: ClientChannel | null;
  initiatorOutboundId: number;
  waiters: BootstrapWaiter[];
}

export function createAcpRuntime(deps: AcpRuntimeDeps): AcpRuntime {
  const orphanTtlMs = deps.orphanTtlMs ?? DEFAULT_ORPHAN_TTL_MS;
  const logBytesCap = deps.logBytesCap ?? DEFAULT_LOG_BYTES_CAP;
  let agent: AgentProcess | null = null;
  let agentExited = false;
  /**
   * Whether the agent advertised `agentCapabilities.sessionCapabilities.close`
   * in its `initialize` response. Some harnesses (notably pi-acp) don't
   * implement `session/close`, and sending it raises an error / kills the
   * subprocess — so the runtime must check the capability before reaping.
   *
   * Defaults to `true` (optimistic): the flag is updated on the first
   * `initialize` response, which under ACP must precede any session-creating
   * request, so the value reflects the real agent before any close is
   * considered. The default only matters in tests that bypass `initialize`.
   */
  let sessionCloseSupported = true;
  /**
   * Every attached channel → set of sessions it is engaged with. Used both
   * as the source of truth for "who's attached" (Map.size) and to decide
   * which channels receive fan-out broadcasts.
   */
  const engagedSessions = new Map<ClientChannel, Set<string>>();
  const pendingFromAgent = new Map<JsonRpcId, PendingAgentRequest>();
  const outboundIdToClient = new Map<number, OutboundMapping>();
  const activePromptBySession = new Map<string, ActivePrompt>();
  const promptQueueBySession = new Map<string, QueuedPrompt[]>();

  /**
   * Append-only per-session log of `session/update` notifications and our
   * synthetic turn-end marker. Agent→client JSON-RPC requests (permission
   * prompts, fs reads, …) are *not* logged — they're live-only, tracked in
   * `pendingFromAgent`, and redelivered to fresh engagers from there. Logging
   * them would cause catchUp to re-emit resolved permission prompts and the
   * UI would re-show dialogs the user already answered.
   */
  const sessionLogs = new Map<string, SessionLog>();

  /**
   * Per-channel cursor tracking: for each engaged session, the last seq the
   * channel has received. An append past the cursor extends the cursor and
   * ships the line; a catch-up replays everything between cursor and latest
   * seq in one burst.
   */
  const channelCursors = new Map<ClientChannel, Map<string, number>>();

  /** Cold-bootstrap coordination — see `BootstrapState`. */
  const bootstrapBySession = new Map<string, BootstrapState>();

  let nextOutboundId = 1;
  /** Per-session orphan timers. A session is orphaned when it has pending
   * agent-initiated requests but no channel engaged with it. */
  const orphanTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // ── Session log ──

  function getOrCreateLog(sessionId: string): SessionLog {
    let log = sessionLogs.get(sessionId);
    if (!log) {
      log = {
        entries: [],
        nextSeq: 1,
        totalBytes: 0,
        truncated: false,
        metadata: null,
      };
      sessionLogs.set(sessionId, log);
    }
    return log;
  }

  /** Append a fanout-ready line to the session log, evicting oldest entries
   * to stay under the byte cap. Returns the assigned seq. */
  function appendToLog(sessionId: string, line: string): number {
    const log = getOrCreateLog(sessionId);
    const bytes = line.length;
    const seq = log.nextSeq++;
    log.entries.push({ seq, line, bytes });
    log.totalBytes += bytes;
    while (log.totalBytes > logBytesCap && log.entries.length > 1) {
      const evicted = log.entries.shift()!;
      log.totalBytes -= evicted.bytes;
      log.truncated = true;
    }
    return seq;
  }

  function cursorFor(channel: ClientChannel, sessionId: string): number {
    const map = channelCursors.get(channel);
    return map?.get(sessionId) ?? 0;
  }

  function setCursor(
    channel: ClientChannel,
    sessionId: string,
    seq: number,
  ): void {
    let map = channelCursors.get(channel);
    if (!map) {
      map = new Map();
      channelCursors.set(channel, map);
    }
    map.set(sessionId, seq);
  }

  /** Sentinel notification prepended to a catch-up when the log has been
   * truncated. Clients render a system-style "older messages not loaded"
   * placeholder. */
  function truncationSentinel(sessionId: string): string {
    return JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: { sessionUpdate: "platform_clipped_replay" },
      },
    });
  }

  /** Stream every log entry past `channel`'s cursor for this session. The
   * channel's cursor is advanced to the latest seq. Prepends the truncation
   * sentinel on the first send after eviction has occurred. */
  function catchUp(channel: ClientChannel, sessionId: string): void {
    const log = sessionLogs.get(sessionId);
    if (!log) return;
    const current = cursorFor(channel, sessionId);
    if (current === 0 && log.truncated && channel.isOpen()) {
      channel.send(truncationSentinel(sessionId));
    }
    let lastSeq = current;
    for (const entry of log.entries) {
      if (entry.seq <= current) continue;
      if (!channel.isOpen()) return;
      channel.send(rewriteAuthError(entry.line));
      lastSeq = entry.seq;
    }
    if (lastSeq !== current) setCursor(channel, sessionId, lastSeq);
  }

  // ── Engagement ──

  function engage(channel: ClientChannel, sessionId: string): void {
    const sessions = engagedSessions.get(channel);
    if (!sessions) return; // channel detached
    if (sessions.has(sessionId)) return; // idempotent
    sessions.add(sessionId);

    // Replay any pending agent→client requests for this session to the
    // newly-engaged channel. A fresh viewer joining an in-progress prompt
    // picks up the permission dialog right away.
    for (const req of pendingFromAgent.values()) {
      if (req.sessionId === sessionId && channel.isOpen()) {
        channel.send(rewriteAuthError(req.frame));
      }
    }

    updateOrphanTimerForSession(sessionId);
  }

  function hasEngagedChannel(sessionId: string): boolean {
    for (const [channel, sessions] of engagedSessions) {
      if (sessions.has(sessionId) && channel.isOpen()) return true;
    }
    return false;
  }

  // ── Fan-out ──

  /** Append `line` to the session's log and ship it to every engaged channel
   * whose cursor is behind the new seq. Each recipient's cursor advances so
   * it can't receive the same line twice.
   *
   * `skipChannel` lets a caller append a line to the log (and advance that
   * channel's cursor) without actually sending to it — used when the client
   * already has the content locally (e.g. the sender of `session/prompt`
   * which rendered an optimistic user bubble before forwarding). The entry
   * is still in the log, so on reconnect that same client catches up to it
   * through a new channel with cursor=0.
   *
   * `onlyChannel` restricts delivery during a cold-bootstrap replay so the
   * agent's historical events populate the log (for future cache hits) but
   * reach only the loader. Other engaged channels already have the history
   * in their React state and would double-render the replay. The key may
   * be set explicitly to `null` to mean "deliver to no channel" — used by
   * the cold-resume path, where the runtime initiated the bootstrap and no
   * client should receive the replay.
   */
  function appendAndFanOut(
    sessionId: string,
    line: string,
    options?: {
      skipChannel?: ClientChannel;
      onlyChannel?: ClientChannel | null;
    },
  ): void {
    const seq = appendToLog(sessionId, line);
    const out = rewriteAuthError(line);
    const onlyChannelSet = options !== undefined && "onlyChannel" in options;
    for (const [channel, sessions] of engagedSessions) {
      if (!sessions.has(sessionId) || !channel.isOpen()) continue;
      if (cursorFor(channel, sessionId) >= seq) continue;
      if (onlyChannelSet && channel !== options!.onlyChannel) {
        setCursor(channel, sessionId, seq);
        continue;
      }
      if (channel === options?.skipChannel) {
        setCursor(channel, sessionId, seq);
        continue;
      }
      channel.send(out);
      setCursor(channel, sessionId, seq);
    }
  }

  /**
   * Synthesize `session/update` notifications for a client's `session/prompt`
   * payload and append them to the log. The Claude Agent SDK drops plain-text
   * user_message_chunk emissions in live (see acp-agent.js: "Skip these user
   * messages for now"), so without this, viewers other than the sender never
   * see the user's message. Running this through the log means it's captured
   * for catch-up too, so any later loader reconstructs the turn correctly.
   *
   * Skips the originating channel at fan-out — the sender's UI already
   * rendered the message as an optimistic bubble. The sender's cursor is
   * still advanced, so subsequent fan-outs don't re-deliver this entry,
   * but a fresh channel (after reload) will catch it through the normal
   * catch-up from cursor=0.
   */
  function appendUserPromptToLog(
    sessionId: string,
    prompt: unknown,
    originator: ClientChannel,
  ): void {
    if (!Array.isArray(prompt)) return;
    for (const block of prompt) {
      if (!block || typeof block !== "object") continue;
      const line = JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId,
          update: { sessionUpdate: "user_message_chunk", content: block },
        },
      });
      appendAndFanOut(sessionId, line, { skipChannel: originator });
    }
  }

  function broadcastToAll(line: string): void {
    const out = rewriteAuthError(line);
    for (const channel of engagedSessions.keys()) {
      if (channel.isOpen()) channel.send(out);
    }
  }

  function sendToChannel(c: ClientChannel, line: string): void {
    if (c.isOpen()) c.send(line);
  }

  // ── Per-session orphan TTL ──

  function updateOrphanTimerForSession(sessionId: string): void {
    const engaged = hasEngagedChannel(sessionId);
    let hasPending = false;
    for (const req of pendingFromAgent.values()) {
      if (req.sessionId === sessionId) {
        hasPending = true;
        break;
      }
    }
    const existing = orphanTimers.get(sessionId);
    const shouldRun = hasPending && !engaged && !agentExited;
    if (shouldRun && !existing) {
      orphanTimers.set(
        sessionId,
        setTimeout(() => expireSession(sessionId), orphanTtlMs),
      );
    } else if (!shouldRun && existing) {
      clearTimeout(existing);
      orphanTimers.delete(sessionId);
    }
  }

  function expireSession(sessionId: string): void {
    orphanTimers.delete(sessionId);
    if (!agent || agentExited) return;
    const toExpire: JsonRpcId[] = [];
    for (const [id, req] of pendingFromAgent) {
      if (req.sessionId === sessionId) toExpire.push(id);
    }
    for (const id of toExpire) {
      // Respond to the agent-side pending JSON-RPC call so it gets a clean
      // error instead of waiting until the Claude Code SDK times out.
      agent.send({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32000,
          message: "Permission request expired: no client connected",
        },
      });
      pendingFromAgent.delete(id);
    }
  }

  // ── Agent lifecycle ──

  function ensureAgent(): AgentProcess | null {
    if (agent && !agentExited) return agent;
    if (agentExited) return null;

    const a = deps.spawnAgent();
    agent = a;
    a.onLine(handleAgentLine);
    a.exited.then(() => {
      agentExited = true;
      for (const channel of engagedSessions.keys()) {
        channel.close(1011, "agent exited");
      }
      engagedSessions.clear();
      channelCursors.clear();
      sessionLogs.clear();
      bootstrapBySession.clear();
      for (const t of orphanTimers.values()) clearTimeout(t);
      orphanTimers.clear();
      pendingFromAgent.clear();
    });
    return a;
  }

  // ── Channel lifecycle ──

  function detach(channel: ClientChannel): void {
    const sessions = engagedSessions.get(channel);
    engagedSessions.delete(channel);
    channelCursors.delete(channel);

    // Drop any prompts this channel had queued but not yet sent to the agent.
    for (const [sid, queue] of promptQueueBySession) {
      const kept = queue.filter((q) => q.channel !== channel);
      if (kept.length) promptQueueBySession.set(sid, kept);
      else promptQueueBySession.delete(sid);
    }

    // Drop bootstrap waiters from this channel, and clear bootstrap state
    // if this channel was the initiator (the agent response will still
    // arrive but we won't have anyone to deliver it to — the mapping
    // cleanup below handles that).
    for (const [sid, state] of bootstrapBySession) {
      if (state.initiatorChannel === channel) {
        bootstrapBySession.delete(sid);
        continue;
      }
      const keptWaiters = state.waiters.filter((w) => w.channel !== channel);
      if (keptWaiters.length !== state.waiters.length) {
        state.waiters = keptWaiters;
      }
    }

    // If this channel owns the currently active prompt, leave the slot occupied
    // but null the channel — the agent is still working on it and we need its
    // response to advance the queue. We just won't forward the response anywhere.
    for (const active of activePromptBySession.values()) {
      if (active.channel === channel) active.channel = null;
    }

    // Drop outbound mappings for non-prompt requests this channel initiated;
    // their responses will be silently discarded if they arrive.
    for (const [outId, m] of outboundIdToClient) {
      if (m.channel === channel && m.promptSessionId === null) {
        outboundIdToClient.delete(outId);
      }
    }

    // Any session this channel was engaged with might now be orphaned.
    // Update the pending-request TTL timer and, if the session has nothing
    // keeping it alive, reap its SDK session so the claude CLI subprocess
    // is freed.
    if (sessions) {
      for (const sid of sessions) {
        updateOrphanTimerForSession(sid);
        maybeCloseIdleSession(sid);
      }
    }
  }

  /**
   * Tear a session down on both sides of the relay: send `session/close` to
   * the agent (if it supports it) and drop the runtime's cache + per-channel
   * cursors. The two halves MUST happen together — otherwise the cache lies
   * to the UI about a session the agent has forgotten, and the next
   * `session/prompt` comes back with "Session not found".
   *
   * Fire-and-forget on the agent side: we don't register the outbound id, so
   * the agent's response is silently dropped by `handleAgentLine`.
   */
  function tearDownSession(sessionId: string): void {
    if (agent && !agentExited && sessionCloseSupported) {
      agent.send({
        jsonrpc: "2.0",
        id: nextOutboundId++,
        method: "session/close",
        params: { sessionId },
      });
    }
    sessionLogs.delete(sessionId);
    for (const cursors of channelCursors.values()) cursors.delete(sessionId);
  }

  /**
   * Refcount-driven reap: when no channel is engaged with the session and no
   * work is in flight, tear it down to free the ~300MB CLI subprocess the
   * SDK pins per session. The cold-bootstrap path rehydrates from disk on
   * the next viewer's `session/resume`.
   *
   * Skipped entirely when the agent doesn't advertise
   * `sessionCapabilities.close`: we can't tell the agent to drop the session,
   * so we also keep the cache so future resumes can still serve from memory.
   */
  function maybeCloseIdleSession(sessionId: string): void {
    if (!agent || agentExited) return;
    if (!sessionCloseSupported) return;
    if (hasEngagedChannel(sessionId)) return;
    if (activePromptBySession.has(sessionId)) return;
    if (promptQueueBySession.has(sessionId)) return;
    // An in-flight cold bootstrap (e.g. runtime-initiated session/load
    // triggered by a cold-resume) is still pinning a session in the agent
    // — closing now would race the load and orphan the cached metadata.
    if (bootstrapBySession.has(sessionId)) return;
    for (const req of pendingFromAgent.values()) {
      if (req.sessionId === sessionId) return;
    }

    tearDownSession(sessionId);
    deps.log?.(`closing idle session ${sessionId}`);
  }

  function sendErrorResponse(
    channel: ClientChannel,
    id: JsonRpcId,
    message: string,
  ): void {
    sendToChannel(
      channel,
      JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message } }),
    );
  }

  // ── Prompt queue ──

  function forwardPromptToAgent(
    a: AgentProcess,
    sessionId: string,
    entry: {
      channel: ClientChannel;
      outboundId: number;
      originalId: JsonRpcId;
      frame: unknown;
    },
  ): void {
    activePromptBySession.set(sessionId, {
      sessionId,
      outboundId: entry.outboundId,
      channel: entry.channel,
      originalId: entry.originalId,
    });
    a.send(entry.frame);
  }

  function advanceQueue(a: AgentProcess, sessionId: string): void {
    const queue = promptQueueBySession.get(sessionId);
    if (!queue || queue.length === 0) {
      promptQueueBySession.delete(sessionId);
      return;
    }
    const next = queue.shift()!;
    if (queue.length === 0) promptQueueBySession.delete(sessionId);
    forwardPromptToAgent(a, sessionId, next);
  }

  // ── session/load and session/resume serve-from-memory ──

  /** Serve a `session/load` from the in-memory log without forwarding to
   * the agent. Stream the catch-up first, then engage the channel and
   * deliver the synthetic response — mirroring the agent's own order
   * (notifications → response). */
  function serveLoadFromLog(
    channel: ClientChannel,
    originalId: JsonRpcId,
    sessionId: string,
    log: SessionLog,
  ): void {
    if (log.metadata === null) {
      throw new Error(
        `serveLoadFromLog called for ${sessionId} without cached metadata`,
      );
    }
    catchUp(channel, sessionId);
    engage(channel, sessionId);
    const response = JSON.stringify({
      jsonrpc: "2.0",
      id: originalId,
      result: log.metadata,
    });
    sendToChannel(channel, rewriteAuthError(response));
  }

  /** Serve a `session/resume` from the in-memory log. Resume's contract is
   * "rebind for future events" — unlike load, it must NOT replay history
   * (the caller already has it via a prior throwaway `session/load`). So
   * we engage the channel and advance its cursor to the log's tail before
   * sending the synthetic response, so future `appendAndFanOut` deliveries
   * land but no historical entry does. The cached `metadata` is captured
   * from `session/new` / `session/fork` / `session/load` responses and is
   * a structural superset of `ResumeSessionResponse`. */
  function serveResumeFromLog(
    channel: ClientChannel,
    originalId: JsonRpcId,
    sessionId: string,
    log: SessionLog,
  ): void {
    if (log.metadata === null) {
      throw new Error(
        `serveResumeFromLog called for ${sessionId} without cached metadata`,
      );
    }
    engage(channel, sessionId);
    const lastSeq =
      log.entries.length > 0 ? log.entries[log.entries.length - 1].seq : 0;
    setCursor(channel, sessionId, lastSeq);
    const response = JSON.stringify({
      jsonrpc: "2.0",
      id: originalId,
      result: log.metadata,
    });
    sendToChannel(channel, rewriteAuthError(response));
  }

  // ── Agent → client traffic ──

  function handleAgentLine(line: string): void {
    const frame = parseFrame(line);

    if (frame && isRequest(frame)) {
      const sessionId = extractParamsSessionId(frame);
      pendingFromAgent.set(frame.id, { sessionId, frame: line });
      if (sessionId) {
        // Live-fan-out only — never log agent→client requests. Once the
        // client responds, pendingFromAgent drops the entry; a logged copy
        // would get replayed on the next catchUp and re-trigger the
        // permission dialog. Fresh engagers still pick up currently-pending
        // requests via engage()'s replay from pendingFromAgent.
        const out = rewriteAuthError(line);
        for (const [channel, sessions] of engagedSessions) {
          if (sessions.has(sessionId) && channel.isOpen()) channel.send(out);
        }
        updateOrphanTimerForSession(sessionId);
      } else {
        broadcastToAll(line);
      }
      return;
    }

    if (frame && isResponse(frame)) {
      const outboundId = frame.id as number;
      const mapping = outboundIdToClient.get(outboundId);
      if (mapping) {
        outboundIdToClient.delete(outboundId);

        // Cache the agent's session capabilities from the initialize response.
        // Per ACP, support for `session/close` is signalled by the presence of
        // `agentCapabilities.sessionCapabilities.close` (a non-null object).
        if (mapping.method === "initialize") {
          sessionCloseSupported = extractSessionCloseSupported(frame);
        }

        // Engage the originating channel with a session identified by the
        // response. session/new and session/fork put the new sessionId in
        // the result body; session/load doesn't (the client already knows
        // the sid from its request) — we recover it from the mapping's
        // attachSessionId captured on forward. session/resume frames are
        // never forwarded to the agent (handled entirely by the runtime),
        // so they never appear here.
        const sidFromResult = extractResultSessionId(frame);
        const sidForChannel = sidFromResult ?? mapping.attachSessionId;
        if (sidForChannel) {
          if (mapping.channel) engage(mapping.channel, sidForChannel);
          // Cache the response body as log metadata on paths that produce
          // authoritative log state: session/new and session/fork start an
          // empty log that the creator's prompts will populate, and
          // session/load populates it via replaySessionHistory.
          const cacheable =
            mapping.method === "session/new" ||
            mapping.method === "session/fork" ||
            mapping.method === "session/load";
          const result = (frame as { result?: unknown }).result;
          if (cacheable && result !== undefined) {
            const log = getOrCreateLog(sidForChannel);
            if (log.metadata === null) {
              log.metadata = result;
            }
          }
          // Record every session/new: a missing entry marks a harness-minted
          // session (TUI /clear), which decodes as terminal downstream.
          if (
            mapping.method === "session/new" &&
            sidFromResult &&
            deps.sessionMetadata
          ) {
            deps.sessionMetadata.set(sidFromResult, mapping.platformMeta ?? {});
          }
        }

        // `session/load` cold-bootstrap response: serve any waiters that
        // arrived during the bootstrap window. Load waiters get full
        // history replay (catchUp); resume waiters get engagement plus a
        // synthetic resume response with no replay (their UI already has
        // history from a prior throwaway loadSession). The original
        // initiator (if any) already received every replay event via
        // appendAndFanOut (engaged on forward), so no catch-up for it.
        if (mapping.method === "session/load" && mapping.attachSessionId) {
          const sid = mapping.attachSessionId;
          const log = getOrCreateLog(sid);
          const boot = bootstrapBySession.get(sid);
          if (boot) {
            bootstrapBySession.delete(sid);
            // Error responses leave metadata null (cache-population guard
            // above requires `result !== undefined`); see SessionLog.metadata
            // invariant for the full coupling.
            const loadFailed = log.metadata === null;
            for (const waiter of boot.waiters) {
              if (!waiter.channel.isOpen()) continue;
              if (loadFailed) {
                // Relay the agent's error to the waiter under its own id
                // — we have no cached metadata to synthesize a response,
                // and a thrown error here would leave the waiter hanging.
                const out = JSON.stringify({
                  ...(frame as object),
                  id: waiter.originalId,
                });
                waiter.channel.send(rewriteAuthError(out));
                continue;
              }
              if (waiter.kind === "load") {
                serveLoadFromLog(waiter.channel, waiter.originalId, sid, log);
              } else {
                serveResumeFromLog(waiter.channel, waiter.originalId, sid, log);
              }
            }
          }
        }

        // Rewrite the response id back to what the originating client used.
        // Skip when the runtime initiated the call (no client to respond to).
        if (mapping.channel && mapping.originalId !== null) {
          const responseFrame =
            mapping.method === "session/list" && deps.sessionMetadata
              ? injectPlatformMetaIntoList(frame, deps.sessionMetadata)
              : (frame as object);
          const out = JSON.stringify({
            ...responseFrame,
            id: mapping.originalId,
          });
          if (mapping.channel.isOpen())
            mapping.channel.send(rewriteAuthError(out));
        }

        // If this response completes a queued prompt, advance the session's
        // queue and signal the turn boundary to every engaged channel so
        // viewers that didn't originate the prompt can close their current
        // assistant bubble. ACP has no on-the-wire "turn ended" notification,
        // so we send a custom JSON-RPC notification — the originating client
        // doesn't need it (its sendPrompt finally fires from the response),
        // but other viewers do. Clients that don't implement extNotification
        // silently swallow it.
        if (mapping.promptSessionId !== null) {
          const sid = mapping.promptSessionId;
          const active = activePromptBySession.get(sid);
          if (active && active.outboundId === outboundId) {
            activePromptBySession.delete(sid);
            if (agent && !agentExited) advanceQueue(agent, sid);
          }
          appendAndFanOut(
            sid,
            JSON.stringify(
              buildPlatformTurnEndedNotification({ sessionId: sid }),
            ),
          );
          // Reap the SDK session if the turn finished with nothing left to
          // watch it — e.g. a scheduled trigger fired a prompt with no UI
          // attached. If a queued prompt was just promoted by advanceQueue,
          // activePromptBySession now has it and maybeCloseIdleSession is a
          // no-op.
          maybeCloseIdleSession(sid);
        }
      }
      return;
    }

    // Notification — append to the session's log and fan out to engaged
    // channels by cursor. Notifications without a sessionId (rare) go to
    // every attached channel.
    //
    // Cold-bootstrap window: when session/load is in flight for this sid,
    // the agent is streaming replaySessionHistory. Those events need to
    // populate the log (so future session/loads hit cache) but MUST NOT
    // fan out to other engaged channels — they already have the history
    // in their React state, and receiving the replay would append a
    // second copy on top. When a real initiator exists, route replay to
    // it only; when the runtime initiated the bootstrap (cold-resume),
    // route to nobody — every engaged channel advances its cursor
    // silently and is later served by the resume waiter handler.
    const sessionId = extractParamsSessionId(frame);
    if (sessionId) {
      const boot = bootstrapBySession.get(sessionId);
      if (boot) {
        appendAndFanOut(sessionId, line, {
          onlyChannel: boot.initiatorChannel,
        });
      } else {
        appendAndFanOut(sessionId, line);
      }
    } else {
      broadcastToAll(line);
    }
  }

  // ── Client → agent traffic ──

  function handleClientMessage(
    a: AgentProcess,
    channel: ClientChannel,
    data: string,
  ): void {
    const frame = parseFrame(data);
    if (!frame) {
      deps.log?.(`dropping non-JSON client message: ${data}`);
      return;
    }

    if (isResponse(frame)) {
      // Client responding to an agent-initiated request. Only forward if the
      // request is still pending — late/duplicate responses (other client
      // already answered) are silently dropped so the agent isn't confused.
      const pending = pendingFromAgent.get(frame.id);
      if (!pending) return;
      pendingFromAgent.delete(frame.id);
      if (pending.sessionId) updateOrphanTimerForSession(pending.sessionId);
      a.send(frame);
      return;
    }

    if (isRequest(frame)) {
      const method =
        typeof (frame as { method?: unknown }).method === "string"
          ? (frame as { method: string }).method
          : "";
      const paramsSid = extractParamsSessionId(frame);

      // `platform/deleteSession` ExtRequest (ADR-055): soft delete — tombstone
      // in the metadata store so `session/list` enrichment hides it even while
      // the harness still lists the on-disk JSONL. Answered synthetically; the
      // vanilla harness has no delete capability, so it never forwards.
      if (method === "platform/deleteSession" && paramsSid) {
        deps.sessionMetadata?.tombstone(paramsSid);
        sendToChannel(
          channel,
          JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: {} }),
        );
        return;
      }

      // `session/resume` short-circuit: the runtime mediates resume entirely.
      // Many harnesses (pi-acp) don't implement `unstable_resumeSession` at
      // all, and even harnesses that do can't resume against a freshly-
      // respawned subprocess that has no in-memory session. The runtime is
      // the only thing that can reconcile both — so resume never reaches
      // the agent.
      //
      //   Hot path: log metadata already cached → engage + advance cursor +
      //             synthetic response (no replay).
      //   Cold path: park as a resume waiter and run a runtime-initiated
      //             session/load (the only ACP RPC that rehydrates a session
      //             in a fresh subprocess). Replay events populate the log
      //             but reach no client. On completion, all resume waiters
      //             are served via `serveResumeFromLog`.
      if (method === "session/resume" && paramsSid) {
        // setMode (ADR-055): a resume may carry `_meta.platform` (e.g. a new
        // mode) — merge it into the stored entry, preserving fields it omits.
        const incomingMeta = extractPlatformMeta(frame);
        if (incomingMeta && deps.sessionMetadata) {
          const current = deps.sessionMetadata.get(paramsSid)?.meta ?? {};
          deps.sessionMetadata.set(paramsSid, { ...current, ...incomingMeta });
        }
        // Engage immediately so the channel receives pending agent requests
        // for the session and has its cursor advanced silently during a
        // cold-bootstrap window. `serveResumeFromLog` will call `engage`
        // again on the hot path / on waiter dispatch — that's intentional
        // and harmless: `engage` is idempotent (early-returns when the
        // session is already in the channel's set).
        engage(channel, paramsSid);
        const existing = sessionLogs.get(paramsSid);
        if (existing && existing.metadata !== null) {
          serveResumeFromLog(channel, frame.id, paramsSid, existing);
          return;
        }
        const boot = bootstrapBySession.get(paramsSid);
        if (boot) {
          boot.waiters.push({ kind: "resume", channel, originalId: frame.id });
          return;
        }
        const outboundId = nextOutboundId++;
        bootstrapBySession.set(paramsSid, {
          initiatorChannel: null,
          initiatorOutboundId: outboundId,
          waiters: [{ kind: "resume", channel, originalId: frame.id }],
        });
        outboundIdToClient.set(outboundId, {
          channel: null,
          originalId: null,
          method: "session/load",
          promptSessionId: null,
          attachSessionId: paramsSid,
          platformMeta: null,
        });
        const loadFrame = {
          jsonrpc: "2.0",
          id: outboundId,
          method: "session/load",
          params: { sessionId: paramsSid, cwd: ".", mcpServers: [] },
        };
        a.send(rewriteCwd(loadFrame, deps.workingDir));
        return;
      }

      // `session/load` short-circuit: if the runtime already has a log with
      // cached metadata for this session, serve the entire history (plus any
      // future live events) from memory. The agent is never involved.
      if (method === "session/load" && paramsSid) {
        const existing = sessionLogs.get(paramsSid);
        if (existing && existing.metadata !== null) {
          serveLoadFromLog(channel, frame.id, paramsSid, existing);
          return;
        }
        // Cold-bootstrap coalescing: if a bootstrap is already in flight for
        // this session, park this channel as a waiter — the in-flight load's
        // response will populate the log, then we serve all waiters from it.
        // This prevents two concurrent `session/load`s from double-forwarding
        // and appending two copies of the same history to the log.
        const boot = bootstrapBySession.get(paramsSid);
        if (boot) {
          boot.waiters.push({ kind: "load", channel, originalId: frame.id });
          return;
        }
      }

      const outboundId = nextOutboundId++;

      // Engage forward so subsequent updates for this session reach this channel.
      if (paramsSid) engage(channel, paramsSid);

      const promptSessionId = method === "session/prompt" ? paramsSid : null;
      // Methods whose response body doesn't echo the sid (session/load) —
      // we stash it from params to recover it when the response comes back.
      const attachSessionId = method === "session/load" ? paramsSid : null;

      const platformMeta =
        method === "session/new" ? extractPlatformMeta(frame) : null;
      const forwardFrame =
        platformMeta !== null ? stripPlatformMeta(frame) : frame;

      const rewritten = rewriteCwd(
        { ...forwardFrame, id: outboundId },
        deps.workingDir,
      );
      outboundIdToClient.set(outboundId, {
        channel,
        originalId: frame.id,
        method,
        promptSessionId,
        attachSessionId,
        platformMeta,
      });

      // Mark a cold bootstrap in flight so concurrent loads of the same sid
      // pile into `waiters` instead of double-forwarding.
      if (method === "session/load" && attachSessionId) {
        bootstrapBySession.set(attachSessionId, {
          initiatorChannel: channel,
          initiatorOutboundId: outboundId,
          waiters: [],
        });
      }

      if (promptSessionId !== null) {
        // Synthesize user_message_chunk(s) from the prompt payload and
        // append them to the log. The SDK drops plain-text user_message_chunk
        // emissions in live, so without this, viewers other than the sender
        // never see the user's message. The runtime fans out to everyone
        // including the sender; the sending client's UI reconciles the echo
        // against its optimistic bubble.
        const promptBlocks = (frame as { params?: { prompt?: unknown } }).params
          ?.prompt;
        appendUserPromptToLog(promptSessionId, promptBlocks, channel);

        if (activePromptBySession.has(promptSessionId)) {
          const queue = promptQueueBySession.get(promptSessionId) ?? [];
          if (queue.length >= PROMPT_QUEUE_CAP) {
            outboundIdToClient.delete(outboundId);
            sendErrorResponse(
              channel,
              frame.id,
              `prompt queue full for session ${promptSessionId}`,
            );
            return;
          }
          queue.push({
            channel,
            outboundId,
            originalId: frame.id,
            frame: rewritten,
          });
          promptQueueBySession.set(promptSessionId, queue);
          return;
        }
        forwardPromptToAgent(a, promptSessionId, {
          channel,
          outboundId,
          originalId: frame.id,
          frame: rewritten,
        });
        return;
      }

      a.send(rewritten);
      return;
    }

    // Client notification (has method, no id). Forward; engage if scoped.
    const notifSid = extractParamsSessionId(frame);
    if (notifSid) engage(channel, notifSid);
    a.send(rewriteCwd(frame, deps.workingDir));
  }

  return {
    attach(channel) {
      const a = ensureAgent();
      if (!a) {
        channel.close(1011, "agent process is not running");
        return;
      }

      engagedSessions.set(channel, new Set());

      channel.onMessage((data) => handleClientMessage(a, channel, data));
      channel.onClose(() => detach(channel));
    },

    status() {
      let queued = 0;
      for (const q of promptQueueBySession.values()) queued += q.length;
      return {
        activeClientCount: engagedSessions.size,
        pendingRequestCount: pendingFromAgent.size,
        queuedPromptCount: queued,
        agentAlive: agent !== null && !agentExited,
      };
    },

    resetSession(sessionId) {
      tearDownSession(sessionId);
      deps.log?.(`reset session ${sessionId}`);
    },

    shutdown() {
      for (const channel of engagedSessions.keys())
        channel.close(1000, "shutdown");
      engagedSessions.clear();
      channelCursors.clear();
      sessionLogs.clear();
      bootstrapBySession.clear();
      for (const t of orphanTimers.values()) clearTimeout(t);
      orphanTimers.clear();
      if (agent && !agentExited) agent.kill();
    },
  };
}

function isNonNullObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function extractPlatformMeta(frame: unknown): PlatformSessionMeta | null {
  if (!isNonNullObject(frame)) return null;
  const params = frame.params;
  if (!isNonNullObject(params)) return null;
  const meta = params._meta;
  if (!isNonNullObject(meta) || !("platform" in meta)) return null;
  const parsed = platformSessionMetaSchema.safeParse(meta.platform);
  return parsed.success ? parsed.data : null;
}

function stripPlatformMeta(frame: unknown): object {
  if (!isNonNullObject(frame)) return frame as object;
  const params = frame.params;
  if (!isNonNullObject(params)) return frame as object;
  const meta = params._meta;
  if (!isNonNullObject(meta)) return frame as object;
  const { platform: _platform, ...restMeta } = meta;
  const nextParams: Record<string, unknown> = { ...params };
  if (Object.keys(restMeta).length > 0) nextParams._meta = restMeta;
  else delete nextParams._meta;
  return { ...frame, params: nextParams };
}

// createdAt rides inside _meta.platform so it round-trips to the server.
function withPlatformMeta(
  session: Record<string, unknown>,
  entry: SessionMetaEntry,
): Record<string, unknown> {
  const existingMeta = isNonNullObject(session._meta) ? session._meta : {};
  return {
    ...session,
    _meta: {
      ...existingMeta,
      platform: { ...entry.meta, createdAt: entry.createdAt },
    },
  };
}

/** Enrich the harness's session list with `_meta.platform` from the store. The
 * harness list is the ground truth for session existence — entries that live
 * only in the store (e.g. a session created via `session/new` but never
 * prompted, so never written to disk, or the UI's config-probe) are NOT
 * invented into the list. A listed session with no store entry passes through
 * unenriched (terminal default); tombstoned sessions are dropped. */
function injectPlatformMetaIntoList(
  frame: unknown,
  store: SessionMetadataStore,
): object {
  if (!isNonNullObject(frame)) return frame as object;
  const result = frame.result;
  if (!isNonNullObject(result)) return frame as object;
  const listed = Array.isArray(result.sessions) ? result.sessions : [];
  const enriched = listed
    .filter(
      (s) =>
        !(
          isNonNullObject(s) &&
          typeof s.sessionId === "string" &&
          store.isTombstoned(s.sessionId)
        ),
    )
    .map((s) => {
      if (!isNonNullObject(s) || typeof s.sessionId !== "string") return s;
      const entry = store.get(s.sessionId);
      return entry ? withPlatformMeta(s, entry) : s;
    });
  return { ...frame, result: { ...result, sessions: enriched } };
}

function extractSessionCloseSupported(frame: unknown): boolean {
  if (!isNonNullObject(frame)) return false;
  const result = frame.result;
  if (!isNonNullObject(result)) return false;
  const caps = result.agentCapabilities;
  if (!isNonNullObject(caps)) return false;
  const session = caps.sessionCapabilities;
  if (!isNonNullObject(session)) return false;
  return isNonNullObject(session.close);
}

function extractParamsSessionId(frame: unknown): string | null {
  if (!isNonNullObject(frame)) return null;
  const params = frame.params;
  if (!isNonNullObject(params)) return null;
  const sid = params.sessionId;
  return typeof sid === "string" ? sid : null;
}

function extractResultSessionId(frame: unknown): string | null {
  if (!isNonNullObject(frame)) return null;
  const result = frame.result;
  if (!isNonNullObject(result)) return null;
  const sid = result.sessionId;
  return typeof sid === "string" ? sid : null;
}
