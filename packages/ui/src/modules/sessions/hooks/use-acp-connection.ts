import type { ClientSideConnection } from "@agentclientprotocol/sdk/dist/acp.js";
import { SessionMode, SessionType } from "api-server-api";
import { useCallback, useEffect, useRef, useState } from "react";

import { useStore } from "../../../store.js";
import type { Message } from "../../../types.js";
import { openInitializedConnection } from "../../acp/acp.js";
import { finalizeAllStreaming } from "../../acp/session-projection.js";
import type { UpdateHandler } from "../../acp/types.js";
import { RECONNECT_DELAYS } from "../../acp/utils.js";

export interface LiveConnection {
  connection: ClientSideConnection;
  ws: WebSocket;
}

/**
 * Observable phase of the chat connection. Surfaced for UI badges
 * ("Reconnecting…" / "Reloading conversation…" etc.); the imperative API
 * (`ensureLive`) drives the underlying state machine.
 *
 *   idle          no live WS, no work in flight
 *   live          WS open + session engaged, ready for prompts
 *   reloading     live WS died — replaying history before reconnecting
 *   reconnecting  backoff timer waiting before next connect attempt
 */
export type ConnectionState = "idle" | "live" | "reloading" | "reconnecting";

interface UseAcpConnectionOptions {
  selectedAgent: string | null;
  sessionId: string | null;
  /** Terminal sessions are PTY-only; never engage ACP for them. */
  sessionMode: SessionMode | null;
  /** Block live-WS opening (e.g. while resumeSession's throwaway is replaying
   *  history) — both channels would otherwise receive the replay stream. */
  liveBlocked: boolean;
  /** Whether the pod is reachable now (running and not mid-restart). While
   *  false the keep-alive and reconnect loop stay parked: the pod can't answer
   *  ACP, and each connect attempt re-wakes a hibernated agent via the relay's
   *  ensureReady. */
  agentOperable: boolean;
  makeUpdateHandler: () => UpdateHandler;
  engage: (conn: ClientSideConnection) => Promise<string | null>;
  /** Record the session binding of a connection this hook kept. */
  bindEngagement: (sessionId: string) => void;
  clearEngagement: () => void;
  loadHistory: (sid: string) => Promise<Message[]>;
  setMessages: (updater: Message[] | ((prev: Message[]) => Message[])) => void;
}

/** An open connection and the session it is engaged to. */
export interface LiveSession {
  connection: ClientSideConnection;
  sessionId: string;
  /** Whether the socket is still open — the nearest thing to a delivery check. */
  isOpen: () => boolean;
}

/**
 * A session created on its own private connection, before anything else knows
 * about either. The caller drives the two moments that follow.
 */
export interface StartedSession {
  connection: ClientSideConnection;
  sessionId: string;
  /** Whether the socket is still open — the nearest thing to a delivery check. */
  isOpen: () => boolean;
  /** Once the prompt is away: keep the channel as the chat's live connection, or
   *  give it up — muted at once, closed by `finish`. The first caller decides;
   *  returns whether the chat owns the channel. */
  settle: (keep: boolean) => boolean;
  /** Once the turn has settled. Closes the channel unless it was kept or another
   *  send is still using it. */
  finish: () => void;
}

export interface UseAcpConnectionResult {
  state: ConnectionState;
  /** Open + engage if needed; resolves to the live session or null. */
  ensureLive: () => Promise<LiveSession | null>;
  /** Create a session on a connection of its own. Concurrent callers share one
   *  session — a blank chat sent to twice must not become two conversations. */
  beginSession: () => Promise<StartedSession>;
  /** Connection handle for callers that need synchronous access (stopAgent
   *  cancels via the live conn without a round-trip through ensureLive). */
  connectionRef: React.MutableRefObject<LiveConnection | null>;
  /** Hard close the live WS and clear any pending reconnect / reload state.
   *  Used by resetSession / resumeSession before they take the connection
   *  through a different path. */
  reset: () => void;
}

/**
 * Owns the live ACP WebSocket lifecycle:
 *
 *   1. `ensureLive()` opens a WS if needed, wires close/error handlers, and
 *      asks the engagement hook to bind it to the active session.
 *   2. `beginSession()` opens a *private* WS and creates a session on it, for a
 *      first prompt that has no session to belong to yet. Nothing else can close
 *      or repoint it, so navigating away mid-creation cannot lose the prompt.
 *   3. On unexpected WS close with an active session, schedules a reload-
 *      then-reconnect: the runtime appended events while we were offline,
 *      so we must `loadSession` before `unstable_resumeSession` (the latter
 *      only attaches the channel for *future* events).
 *   4. The keep-alive effect makes sure a live WS exists whenever the user
 *      is viewing a session — without it, sidebar-click resume opens a
 *      throwaway socket and never re-engages.
 *
 * Concentrating all of this in one hook means the refs that today encode
 * the lifecycle (`pendingReloadRef`, `reconnectFnRef`, etc.) all live next
 * to the code that reads them.
 */
export function useAcpConnection(
  opts: UseAcpConnectionOptions,
): UseAcpConnectionResult {
  const {
    selectedAgent,
    sessionId,
    sessionMode,
    liveBlocked,
    agentOperable,
    makeUpdateHandler,
    engage,
    bindEngagement,
    clearEngagement,
    loadHistory,
    setMessages,
  } = opts;

  const connectionRef = useRef<LiveConnection | null>(null);
  const ensureInFlightRef = useRef<Promise<LiveSession | null> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const isMountedRef = useRef(true);
  const reconnectFnRef = useRef<(() => void) | null>(null);
  // Set when a live WS dies unexpectedly so the next ensureLive reloads from
  // the runtime log before reattaching. session/resume on its own only
  // engages for *future* events, so anything appended during the gap stays
  // stranded otherwise.
  const pendingReloadRef = useRef(false);
  // Bumped whenever the live connection is replaced or dropped. An `ensureLive`
  // that started before the bump must not install its socket afterwards.
  const generationRef = useRef(0);
  const startInFlightRef = useRef<{
    holders: { count: number };
    promise: Promise<StartedSession>;
  } | null>(null);

  const [state, setState] = useState<ConnectionState>("idle");

  // Mirror of agentOperable so the late-bound reconnect closure reads the
  // latest value without re-subscribing.
  const operableRef = useRef(agentOperable);
  useEffect(() => {
    operableRef.current = agentOperable;
  }, [agentOperable]);

  // Assign on mount, not just on cleanup: StrictMode runs setup → cleanup →
  // setup on one fiber, and a ref that is only ever cleared stays false for the
  // component's whole life in dev.
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      connectionRef.current?.ws.close();
      connectionRef.current = null;
      clearEngagement();
    };
  }, [clearEngagement]);

  // addEventListener (not onclose=) so we don't clobber the handler that closes
  // the ACP ReadableStream controller inside openConnection.
  const attachCloseHandler = useCallback(
    (ws: WebSocket) => {
      ws.addEventListener("close", () => {
        // Skip if a newer WS has taken over (resetConnection→ensureLive race).
        if (connectionRef.current?.ws !== ws) return;
        connectionRef.current = null;
        clearEngagement();
        // Mark reload-on-next-ensureLive only if a session is bound — no
        // session means there's nothing to reload.
        if (useStore.getState().sessionId) pendingReloadRef.current = true;
        // Any in-flight stream is now dead. Finalize streaming bubbles so
        // busy clears and the next turn opens a fresh bubble instead of
        // merging into a stale one.
        setMessages((prev) => finalizeAllStreaming(prev));
        setState("idle");
        reconnectFnRef.current?.();
      });
    },
    [clearEngagement, setMessages],
  );

  /** Stop offering a started session for sharing, so no send can join it later. */
  const releaseStartSlot = useCallback((holders: { count: number }) => {
    if (startInFlightRef.current?.holders === holders) {
      startInFlightRef.current = null;
    }
  }, []);

  /** Precondition: `ws` is open — a closed socket's close event has already
   *  fired, so nothing would ever clear the engagement it leaves behind. */
  const keepAsLive = useCallback(
    (
      connection: ClientSideConnection,
      ws: WebSocket,
      startedSessionId: string,
    ) => {
      // Refs and generation before the store write: committing the session id
      // wakes the keep-alive effect, which must find this connection or it opens
      // a second channel to the same session and every update applies twice.
      connectionRef.current?.ws.close();
      attachCloseHandler(ws);
      connectionRef.current = { connection, ws };
      bindEngagement(startedSessionId);
      pendingReloadRef.current = false;
      generationRef.current += 1;
      ensureInFlightRef.current = null;
      setState("live");
      useStore.getState().setSessionId(startedSessionId);
    },
    [attachCloseHandler, bindEngagement],
  );

  const startSession = useCallback(
    async (holders: { count: number }): Promise<StartedSession> => {
      if (!selectedAgent) throw new Error("No agent selected");

      // Muted when the channel is given up, not when it closes: navigating away
      // and straight back would otherwise leave two channels painting one session.
      let listening = true;
      let settled = false;
      let kept = false;
      const handler = makeUpdateHandler();
      const { connection, ws } = await openInitializedConnection(
        selectedAgent,
        (update, updateSessionId) => {
          if (listening) handler(update, updateSessionId);
        },
      );
      // Registered before anyone can join: whatever kills the socket also ends
      // its shareability.
      ws.addEventListener("close", () => releaseStartSlot(holders));

      let startedSessionId: string;
      try {
        // Unstamped sessions decode as terminal-by-default.
        const session = await connection.newSession({
          cwd: ".",
          mcpServers: [],
          _meta: {
            platform: { mode: SessionMode.Chat, type: SessionType.Regular },
          },
        });
        startedSessionId = session.sessionId;
      } catch (err) {
        try {
          ws.close();
        } catch {}
        throw err;
      }

      return {
        connection,
        sessionId: startedSessionId,
        isOpen: () => ws.readyState === WebSocket.OPEN,
        settle: (keep) => {
          if (settled) return kept;
          settled = true;
          releaseStartSlot(holders);
          // A dead socket is no use to the chat, and its session was never
          // prompted — give it up rather than commit an orphan.
          kept = keep && ws.readyState === WebSocket.OPEN;
          if (!kept) {
            listening = false;
            return false;
          }
          keepAsLive(connection, ws, startedSessionId);
          return true;
        },
        finish: () => {
          holders.count -= 1;
          // A second send may still be queued on this channel; closing now would
          // have the runtime discard its prompt.
          if (holders.count > 0 || kept) return;
          listening = false;
          releaseStartSlot(holders);
          try {
            ws.close();
          } catch {}
        },
      };
    },
    [selectedAgent, makeUpdateHandler, keepAsLive, releaseStartSlot],
  );

  const beginSession = useCallback((): Promise<StartedSession> => {
    const pending = startInFlightRef.current;
    if (pending) {
      pending.holders.count += 1;
      return pending.promise;
    }
    const holders = { count: 1 };
    const promise = startSession(holders);
    startInFlightRef.current = { holders, promise };
    // No socket to carry the eviction when the connect itself fails.
    promise.catch(() => releaseStartSlot(holders));
    return promise;
  }, [startSession, releaseStartSlot]);

  const ensureInner = useCallback(async (): Promise<LiveSession | null> => {
    if (!selectedAgent) return null;
    const generation = generationRef.current;

    // If the previous live WS died with an active session, replay history
    // before opening a fresh socket. We swap the messages array in one
    // render rather than pre-clearing, so the user keeps seeing their
    // existing conversation until the fresh array is ready.
    if (pendingReloadRef.current) {
      const sid = useStore.getState().sessionId;
      pendingReloadRef.current = false;
      if (sid) {
        setState("reloading");
        try {
          const fresh = await loadHistory(sid);

          if (useStore.getState().sessionId !== sid) return null;
          setMessages(fresh);
        } catch (e) {
          // Network still unreachable — restore the flag so the next
          // ensureLive (likely the next reconnect-timer fire) tries again.
          pendingReloadRef.current = true;
          throw e;
        }
      }
    }

    if (
      !connectionRef.current ||
      connectionRef.current.ws.readyState !== WebSocket.OPEN
    ) {
      const { connection, ws } = await openInitializedConnection(
        selectedAgent,
        makeUpdateHandler(),
      );
      // The live connection was replaced or dropped while we were connecting —
      // installing this socket now would orphan the one that took over.
      if (generation !== generationRef.current) {
        try {
          ws.close();
        } catch {}
        return null;
      }
      attachCloseHandler(ws);
      connectionRef.current = { connection, ws };
    }

    const live = connectionRef.current;
    const engagedSessionId = await engage(live.connection);
    if (!engagedSessionId || generation !== generationRef.current) return null;
    setState("live");
    return {
      connection: live.connection,
      sessionId: engagedSessionId,
      isOpen: () => live.ws.readyState === WebSocket.OPEN,
    };
  }, [
    selectedAgent,
    makeUpdateHandler,
    attachCloseHandler,
    engage,
    loadHistory,
    setMessages,
  ]);

  const ensureLive = useCallback((): Promise<LiveSession | null> => {
    if (!ensureInFlightRef.current) {
      const inFlight = ensureInner().finally(() => {
        if (ensureInFlightRef.current === inFlight) {
          ensureInFlightRef.current = null;
        }
      });
      ensureInFlightRef.current = inFlight;
    }
    return ensureInFlightRef.current;
  }, [ensureInner]);

  // Reconnect closure: late-bound via ref so the WS close handler can call
  // it without participating in ensureInner's dep graph. Recreated each time
  // selectedAgent / ensureLive change so the captured values stay fresh.
  // Note: `useStore.getState().selectedAgent` is the canonical store field.
  useEffect(() => {
    reconnectFnRef.current = () => {
      if (!isMountedRef.current) return;
      // Pod isn't reachable — don't reconnect (and don't re-wake it). The
      // keep-alive effect re-engages once it flips back to operable.
      if (!operableRef.current) return;
      const sid = useStore.getState().sessionId;
      const inst = useStore.getState().selectedAgent;
      if (!sid || inst !== selectedAgent) return;
      if (reconnectTimerRef.current) return;

      const attempt = reconnectAttemptRef.current;
      const delay =
        RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)];
      reconnectAttemptRef.current = attempt + 1;
      setState("reconnecting");

      reconnectTimerRef.current = setTimeout(async () => {
        reconnectTimerRef.current = null;
        if (!isMountedRef.current || !operableRef.current) return;
        const currentSid = useStore.getState().sessionId;
        const currentInst = useStore.getState().selectedAgent;
        if (!currentSid || currentInst !== selectedAgent) return;
        try {
          await ensureLive();
          reconnectAttemptRef.current = 0;
        } catch {
          reconnectFnRef.current?.();
        }
      }, delay);
    };
  }, [selectedAgent, ensureLive]);

  // Reset reconnect backoff when the user navigates to a different session
  // or agent — the delays are scoped to a single connection's run.
  useEffect(() => {
    reconnectAttemptRef.current = 0;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, [sessionId, selectedAgent]);

  // Keep-alive: open a live channel whenever we're viewing a session. Without
  // this, sidebar-click resume opens a throwaway WS for history replay, and
  // any pending tool-permission prompt replayed there has no live channel to
  // answer on.
  useEffect(() => {
    if (!selectedAgent || !sessionId || liveBlocked || !agentOperable) return;
    if (sessionMode === SessionMode.Terminal) return;
    ensureLive().catch(() => {});
  }, [
    selectedAgent,
    sessionId,
    sessionMode,
    liveBlocked,
    agentOperable,
    ensureLive,
  ]);

  const reset = useCallback(() => {
    connectionRef.current?.ws.close();
    connectionRef.current = null;
    clearEngagement();
    pendingReloadRef.current = false;
    generationRef.current += 1;
    ensureInFlightRef.current = null;
    // Unshared but not closed: the chat is gone, its turn is the agent's to
    // finish, and the blank chat replacing it is a different conversation.
    startInFlightRef.current = null;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    reconnectAttemptRef.current = 0;
    setState("idle");
  }, [clearEngagement]);

  // Tear the channel down when we leave the session — including switching to a
  // terminal (no ACP), which otherwise stays engaged and marks the chat "seen"
  // on turn completion, so it never shows unread.
  useEffect(() => {
    if (sessionId && sessionMode !== SessionMode.Terminal) return;
    reset();
  }, [sessionId, sessionMode, reset]);

  return { state, ensureLive, beginSession, connectionRef, reset };
}
