import type { ClientSideConnection } from "@agentclientprotocol/sdk/dist/acp.js";
import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk/dist/acp.js";
import { SessionMode } from "api-server-api";
import { useCallback, useEffect, useRef, useState } from "react";

import { useStore } from "../../../store.js";
import type { Message } from "../../../types.js";
import { openConnection } from "../../acp/acp.js";
import { finalizeAllStreaming } from "../../acp/session-projection.js";
import type { UpdateHandler } from "../../acp/types.js";
import { RECONNECT_DELAYS } from "../../acp/utils.js";

interface LiveConnection {
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
  engage: (conn: ClientSideConnection) => Promise<void>;
  clearEngagement: () => void;
  loadHistory: (sid: string) => Promise<Message[]>;
  setMessages: (updater: Message[] | ((prev: Message[]) => Message[])) => void;
}

export interface UseAcpConnectionResult {
  state: ConnectionState;
  /** Open + engage if needed; resolves to the live connection or null. */
  ensureLive: () => Promise<ClientSideConnection | null>;
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
 *   2. On unexpected WS close with an active session, schedules a reload-
 *      then-reconnect: the runtime appended events while we were offline,
 *      so we must `loadSession` before `unstable_resumeSession` (the latter
 *      only attaches the channel for *future* events).
 *   3. The keep-alive effect makes sure a live WS exists whenever the user
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
    clearEngagement,
    loadHistory,
    setMessages,
  } = opts;

  const connectionRef = useRef<LiveConnection | null>(null);
  const ensureInFlightRef = useRef<Promise<ClientSideConnection | null> | null>(
    null,
  );
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const isMountedRef = useRef(true);
  const reconnectFnRef = useRef<(() => void) | null>(null);
  // Set when a live WS dies unexpectedly so the next ensureLive reloads from
  // the runtime log before reattaching. session/resume on its own only
  // engages for *future* events, so anything appended during the gap stays
  // stranded otherwise.
  const pendingReloadRef = useRef(false);

  const [state, setState] = useState<ConnectionState>("idle");

  // Mirror of agentOperable so the late-bound reconnect closure reads the
  // latest value without re-subscribing.
  const operableRef = useRef(agentOperable);
  useEffect(() => {
    operableRef.current = agentOperable;
  }, [agentOperable]);

  // Cleanup on unmount: cancel any in-flight reconnect, close the live WS.
  useEffect(
    () => () => {
      isMountedRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      connectionRef.current?.ws.close();
      connectionRef.current = null;
      clearEngagement();
    },
    [clearEngagement],
  );

  const ensureInner =
    useCallback(async (): Promise<ClientSideConnection | null> => {
      if (!selectedAgent) return null;

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
        const { connection, ws } = await openConnection(
          selectedAgent,
          makeUpdateHandler(),
        );
        await connection.initialize({
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: true },
          },
        });
        // addEventListener (not onclose=) so we don't clobber the handler that
        // closes the ACP ReadableStream controller inside openConnection.
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
        connectionRef.current = { connection, ws };
      }

      const conn = connectionRef.current.connection;
      await engage(conn);
      setState("live");
      return conn;
    }, [
      selectedAgent,
      makeUpdateHandler,
      engage,
      clearEngagement,
      loadHistory,
      setMessages,
    ]);

  const ensureLive = useCallback((): Promise<ClientSideConnection | null> => {
    if (!ensureInFlightRef.current) {
      ensureInFlightRef.current = ensureInner().finally(() => {
        ensureInFlightRef.current = null;
      });
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

  return { state, ensureLive, connectionRef, reset };
}
