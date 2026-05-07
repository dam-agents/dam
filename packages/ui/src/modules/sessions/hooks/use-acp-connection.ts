import type { ClientSideConnection } from "@agentclientprotocol/sdk/dist/acp.js";
import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk/dist/acp.js";
import type { McpServer } from "@agentclientprotocol/sdk/dist/schema/types.gen.js";
import { useCallback, useEffect, useRef, useState } from "react";

import { useStore } from "../../../store.js";
import type { Message } from "../../../types.js";
import { openConnection } from "../../acp/acp.js";
import { hasLocalPromptId } from "../../acp/local-prompt-ids.js";
import {
  applyUpdate,
  finalizeAllStreaming,
} from "../../acp/session-projection.js";
import type { AcpUpdate, SessionConfigPayload, UpdateHandler } from "../../acp/types.js";
import { RECONNECT_DELAYS } from "../../acp/utils.js";

interface LiveConnection {
  connection: ClientSideConnection;
  ws: WebSocket;
}

/**
 * Connection state surfaced for UI badges.
 *
 *   idle          no WS, no work in flight
 *   loading       WS open + load/new session in flight (replaying history)
 *   live          WS open + session bound, ready for prompts
 *   reconnecting  backoff timer running before next connect attempt
 */
export type ConnectionState = "idle" | "loading" | "live" | "reconnecting";

interface UseAcpConnectionOptions {
  selectedInstance: string | null;
  sessionId: string | null;
  selectedMcpServers: McpServer[];
  makeUpdateHandler: () => UpdateHandler;
  captureSessionConfig: (response: SessionConfigPayload) => void;
  handleConfigUpdate: (update: AcpUpdate) => void;
  applySavedPreferences: (
    conn: ClientSideConnection,
    sid: string,
    sessionResponse: SessionConfigPayload,
  ) => Promise<void>;
  setMessages: (updater: Message[] | ((prev: Message[]) => Message[])) => void;
  setSessionId: (id: string | null) => void;
}

export interface UseAcpConnectionResult {
  state: ConnectionState;
  /** Open + bind to the active session if needed; resolves to the live
   *  connection or null on failure. */
  ensureLive: () => Promise<ClientSideConnection | null>;
  /** Connection handle for callers that need synchronous access (stopAgent
   *  cancels via the live conn without a round-trip through ensureLive). */
  connectionRef: React.MutableRefObject<LiveConnection | null>;
  /** The session id the live WS is currently bound to. */
  engagedSessionIdRef: React.MutableRefObject<string | null>;
  /** Hard close the live WS and clear any pending reconnect / loading state.
   *  Used by resetSession / resumeSession before they take the connection
   *  through a different path. */
  reset: () => void;
}

/**
 * Owns the entire chat WebSocket lifecycle: load + live on a single
 * channel.
 *
 * Earlier this hook used a "throwaway WS for history then live WS for
 * stream" pattern coordinated by a `liveBlocked` flag. That pattern lost
 * frames the wrapper appended *between* the throwaway's close and the
 * live WS's `unstable_resumeSession` — the wrapper's per-channel cursor
 * jumped to the log tail at resume time, deliberately skipping replay,
 * but on the assumption that the throwaway had already covered everything
 * up to that point. It hadn't — the "between" window was unobserved on
 * either channel.
 *
 * The fix: a single WS does `loadSession` (which makes the wrapper's
 * `serveLoadFromLog` engage *this* channel and stream the full log) and
 * keeps listening on the same channel for live updates. The wrapper's
 * cursor advances naturally from catch-up into live; no gap.
 *
 * Replay vs. live phasing:
 *   - During the loadSession round-trip, session/update notifications are
 *     the wrapper's history replay. We accumulate them into a local array
 *     (`replayed`) and don't touch the store, so the user keeps seeing the
 *     existing conversation until the fresh array is ready.
 *   - When loadSession resolves, we atomically swap `replayed` into the
 *     store via `setMessages` and flip phase to live. Subsequent updates
 *     run through the full live handler.
 *
 * Token-based ownership: every `inner()` call mints a fresh `Symbol`
 * tracked in `activeTokenRef`. The WS close handler captures that symbol
 * and only runs cleanup if it's still the active token — older close
 * events (e.g. after a `reset()` that opens a fresh connection) are
 * stale and ignored. `inner()` itself checks the token at every yield
 * point and bails if a newer call has taken over.
 */
export function useAcpConnection(opts: UseAcpConnectionOptions): UseAcpConnectionResult {
  const {
    selectedInstance, sessionId, selectedMcpServers,
    makeUpdateHandler,
    captureSessionConfig, handleConfigUpdate, applySavedPreferences,
    setMessages, setSessionId,
  } = opts;

  const connectionRef = useRef<LiveConnection | null>(null);
  const engagedSessionIdRef = useRef<string | null>(null);
  const ensureInFlightRef = useRef<Promise<ClientSideConnection | null> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const isMountedRef = useRef(true);
  const reconnectFnRef = useRef<(() => void) | null>(null);
  /** Identity of the currently-active inner() call. Stale WS close events
   *  (from a prior conn that's still tearing down) skip cleanup if their
   *  captured token doesn't match. */
  const activeTokenRef = useRef<symbol | null>(null);

  const [state, setState] = useState<ConnectionState>("idle");

  // Cleanup on unmount.
  useEffect(() => () => {
    isMountedRef.current = false;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    activeTokenRef.current = null;
    connectionRef.current?.ws.close();
    connectionRef.current = null;
    engagedSessionIdRef.current = null;
  }, []);

  const inner = useCallback(async (): Promise<ClientSideConnection | null> => {
    if (!selectedInstance) return null;

    // Re-use a healthy live connection if it's already bound to the
    // currently-selected session.
    const existing = connectionRef.current;
    if (existing && existing.ws.readyState === WebSocket.OPEN
        && engagedSessionIdRef.current
        && engagedSessionIdRef.current === useStore.getState().sessionId) {
      return existing.connection;
    }

    const myToken = Symbol();
    activeTokenRef.current = myToken;
    const stillActive = () => activeTokenRef.current === myToken;

    setState("loading");

    let phase: "replay" | "live" = "replay";
    let replayed: Message[] = [];
    const liveHandler = makeUpdateHandler();

    const handler: UpdateHandler = (update) => {
      // Drop the wrapper's echo of our own prompts (durable-send path):
      // the optimistic bubble is already keyed on the same promptId, and
      // mergeParts would concatenate text otherwise. Filtering before the
      // projection keeps the projection pure (no tab-local state). Other
      // tabs and cold-replay are unaffected — their local sets don't
      // contain this id.
      if (update.sessionUpdate === "user_message_chunk") {
        const promptId = typeof update._meta?.promptId === "string"
          ? update._meta.promptId
          : null;
        if (promptId && hasLocalPromptId(promptId)) return;
      }
      // Config notifications (mode / option changes) always go to the
      // store: the popover should reflect the latest state regardless of
      // whether we're replaying history or watching live.
      handleConfigUpdate(update);
      if (phase === "replay") {
        replayed = applyUpdate(replayed, update);
      } else {
        liveHandler(update);
      }
    };

    let conn: LiveConnection;
    try {
      conn = await openConnection(selectedInstance, handler);
    } catch (err) {
      if (stillActive()) setState("idle");
      throw err;
    }

    if (!stillActive()) {
      conn.ws.close();
      return null;
    }

    // Wire close handler before we await further. A WS death during
    // initialize / loadSession / newSession should still drive reconnect.
    // Token check makes stale close events from prior conns no-ops.
    conn.ws.addEventListener("close", () => {
      if (activeTokenRef.current !== myToken) return;
      activeTokenRef.current = null;
      if (connectionRef.current?.ws === conn.ws) connectionRef.current = null;
      engagedSessionIdRef.current = null;
      ensureInFlightRef.current = null;
      // Any in-flight stream is now dead. Finalize streaming bubbles so
      // busy clears and the next turn opens a fresh bubble instead of
      // merging into a stale one.
      setMessages((prev) => finalizeAllStreaming(prev));
      setState("idle");
      // Auto-reconnect only if a session is bound; if user reset the
      // session there's nothing to come back to.
      if (useStore.getState().sessionId) reconnectFnRef.current?.();
    });

    try {
      await conn.connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      });
      if (!stillActive()) { conn.ws.close(); return null; }

      const targetSid = useStore.getState().sessionId;

      if (targetSid) {
        const resp = await conn.connection.loadSession({
          sessionId: targetSid,
          cwd: ".",
          mcpServers: selectedMcpServers,
        });
        if (!stillActive() || useStore.getState().sessionId !== targetSid) {
          conn.ws.close();
          return null;
        }
        captureSessionConfig(resp);
        engagedSessionIdRef.current = targetSid;
        await applySavedPreferences(conn.connection, targetSid, resp);
        if (!stillActive()) { conn.ws.close(); return null; }
        phase = "live";
        setMessages(finalizeAllStreaming(replayed));
      } else {
        const s = await conn.connection.newSession({
          cwd: ".",
          mcpServers: selectedMcpServers,
        });
        if (!stillActive() || useStore.getState().sessionId) {
          // Token expired, OR user picked an existing session while we
          // were creating a new one. Bail; the keepalive effect will
          // pick up the right path.
          conn.ws.close();
          return null;
        }
        captureSessionConfig(s);
        setSessionId(s.sessionId);
        engagedSessionIdRef.current = s.sessionId;
        await applySavedPreferences(conn.connection, s.sessionId, s);
        if (!stillActive()) { conn.ws.close(); return null; }
        phase = "live";
      }

      connectionRef.current = conn;
      reconnectAttemptRef.current = 0;
      setState("live");
      return conn.connection;
    } catch (err) {
      if (stillActive()) {
        conn.ws.close();
        setState("idle");
      }
      throw err;
    }
  }, [
    selectedInstance, selectedMcpServers,
    makeUpdateHandler, captureSessionConfig, handleConfigUpdate,
    applySavedPreferences, setMessages, setSessionId,
  ]);

  const ensureLive = useCallback((): Promise<ClientSideConnection | null> => {
    if (!ensureInFlightRef.current) {
      ensureInFlightRef.current = inner().finally(() => {
        ensureInFlightRef.current = null;
      });
    }
    return ensureInFlightRef.current;
  }, [inner]);

  // Reconnect closure: late-bound via ref so the WS close handler can call
  // it without participating in inner's dep graph. Recreated each time
  // selectedInstance / ensureLive change so the captured values stay fresh.
  useEffect(() => {
    reconnectFnRef.current = () => {
      if (!isMountedRef.current) return;
      const sid = useStore.getState().sessionId;
      const inst = useStore.getState().selectedInstance;
      if (!sid || inst !== selectedInstance) return;
      if (reconnectTimerRef.current) return;

      const attempt = reconnectAttemptRef.current;
      const delay = RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)];
      reconnectAttemptRef.current = attempt + 1;
      setState("reconnecting");

      reconnectTimerRef.current = setTimeout(async () => {
        reconnectTimerRef.current = null;
        if (!isMountedRef.current) return;
        const currentSid = useStore.getState().sessionId;
        const currentInst = useStore.getState().selectedInstance;
        if (!currentSid || currentInst !== selectedInstance) return;
        try {
          await ensureLive();
        } catch {
          reconnectFnRef.current?.();
        }
      }, delay);
    };
  }, [selectedInstance, ensureLive]);

  // Reset reconnect backoff when the user navigates to a different session
  // or instance — the delays are scoped to a single connection's run.
  useEffect(() => {
    reconnectAttemptRef.current = 0;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, [sessionId, selectedInstance]);

  // Keep-alive: open a live channel whenever we're viewing a session.
  useEffect(() => {
    if (!selectedInstance || !sessionId) return;
    ensureLive().catch(() => {});
  }, [selectedInstance, sessionId, ensureLive]);

  const reset = useCallback(() => {
    activeTokenRef.current = null;
    ensureInFlightRef.current = null;
    connectionRef.current?.ws.close();
    connectionRef.current = null;
    engagedSessionIdRef.current = null;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    reconnectAttemptRef.current = 0;
    setState("idle");
  }, []);

  return { state, ensureLive, connectionRef, engagedSessionIdRef, reset };
}
