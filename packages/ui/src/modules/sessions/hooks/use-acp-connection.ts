import type { ClientSideConnection } from "@agentclientprotocol/sdk/dist/acp.js";
import {
  platformClippedReplayMetaSchema,
  platformReplayTurnMetaSchema,
  platformUndeliveredMetaSchema,
  SessionMode,
  SessionType,
} from "api-server-api";
import { useCallback, useEffect, useRef, useState } from "react";

import { useStore } from "../../../store.js";
import type { Message } from "../../../types.js";
import { openInitializedConnection } from "../../acp/acp.js";
import {
  appendUndelivered,
  applyUpdate,
  failQueuedOnDisconnect,
  mergeLocalFailures,
  settleReplay,
} from "../../acp/session-projection.js";
import type { AcpUpdate, UpdateHandler } from "../../acp/types.js";
import { RECONNECT_DELAYS } from "../../acp/utils.js";
import { handOverUndelivered } from "../api/acp-session-ops.js";
import { draftKey } from "../lib/draft-key.js";
import { clearUndelivered, readUndelivered } from "../lib/undelivered-store.js";
import type { PromptDelivery } from "./use-prompt-delivery.js";

export interface LiveConnection {
  connection: ClientSideConnection;
  ws: WebSocket;
}

export type ConnectionState = "idle" | "live" | "reloading" | "reconnecting";

interface UseAcpConnectionOptions {
  selectedAgent: string | null;
  sessionId: string | null;
  sessionMode: SessionMode | null;
  liveBlocked: boolean;
  agentOperable: boolean;
  makeUpdateHandler: () => UpdateHandler;
  engage: (conn: ClientSideConnection) => Promise<string | null>;
  bindEngagement: (sessionId: string) => void;
  clearEngagement: () => void;
  setMessages: (updater: Message[] | ((prev: Message[]) => Message[])) => void;
  delivery: PromptDelivery;
}

export interface LiveSession {
  connection: ClientSideConnection;
  sessionId: string;
  isOpen: () => boolean;
}

export interface StartedSession {
  connection: ClientSideConnection;
  sessionId: string;
  isOpen: () => boolean;
  settle: (keep: boolean) => boolean;
  finish: () => void;
}

export interface UseAcpConnectionResult {
  state: ConnectionState;
  ensureLive: () => Promise<LiveSession | null>;
  beginSession: () => Promise<StartedSession>;
  loadSessionHistory: (
    sid: string,
    replayBefore?: string,
  ) => Promise<Message[]>;
  connectionRef: React.MutableRefObject<LiveConnection | null>;
  reset: () => void;
}

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
    setMessages,
    delivery,
  } = opts;

  const connectionRef = useRef<LiveConnection | null>(null);
  const ensureInFlightRef = useRef<Promise<LiveSession | null> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const isMountedRef = useRef(true);
  const reconnectFnRef = useRef<(() => void) | null>(null);
  const pendingReloadRef = useRef(false);
  const generationRef = useRef(0);
  const startInFlightRef = useRef<{
    holders: { count: number };
    promise: Promise<StartedSession>;
  } | null>(null);

  const [state, setState] = useState<ConnectionState>("idle");

  const operableRef = useRef(agentOperable);
  useEffect(() => {
    operableRef.current = agentOperable;
  }, [agentOperable]);

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

  const attachCloseHandler = useCallback(
    (ws: WebSocket) => {
      ws.addEventListener("close", () => {
        if (connectionRef.current?.ws !== ws) return;
        connectionRef.current = null;
        clearEngagement();
        if (useStore.getState().sessionId) pendingReloadRef.current = true;
        delivery.cancelAll();
        setMessages((prev) => failQueuedOnDisconnect(prev));
        setState("idle");
        reconnectFnRef.current?.();
      });
    },
    [clearEngagement, setMessages, delivery],
  );

  const releaseStartSlot = useCallback((holders: { count: number }) => {
    if (startInFlightRef.current?.holders === holders) {
      startInFlightRef.current = null;
    }
  }, []);

  const keepAsLive = useCallback(
    (
      connection: ClientSideConnection,
      ws: WebSocket,
      agentId: string,
      startedSessionId: string,
    ) => {
      connectionRef.current?.ws.close();
      attachCloseHandler(ws);
      connectionRef.current = { connection, ws };
      bindEngagement(startedSessionId);
      pendingReloadRef.current = false;
      generationRef.current += 1;
      ensureInFlightRef.current = null;
      setState("live");
      const store = useStore.getState();
      store.migrateDraft(
        draftKey(agentId, null),
        draftKey(agentId, startedSessionId),
      );
      store.setSessionId(startedSessionId);
    },
    [attachCloseHandler, bindEngagement],
  );

  const startSession = useCallback(
    async (holders: { count: number }): Promise<StartedSession> => {
      if (!selectedAgent) throw new Error("No agent selected");
      const agentId = selectedAgent;

      let listening = true;
      let settled = false;
      let kept = false;
      const handler = makeUpdateHandler();
      const { connection, ws } = await openInitializedConnection(
        selectedAgent,
        (update, updateSessionId, replayFor) => {
          if (listening) handler(update, updateSessionId, replayFor);
        },
      );
      ws.addEventListener("close", () => releaseStartSlot(holders));

      let startedSessionId: string;
      try {
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
          kept = keep && ws.readyState === WebSocket.OPEN;
          if (!kept) {
            listening = false;
            return false;
          }
          keepAsLive(connection, ws, agentId, startedSessionId);
          return true;
        },
        finish: () => {
          holders.count -= 1;
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
    promise.catch(() => releaseStartSlot(holders));
    return promise;
  }, [startSession, releaseStartSlot]);

  const collectorRef = useRef<{
    sid: string;
    token: string;
    updates: AcpUpdate[];
  } | null>(null);

  const openConnection = useCallback(async (): Promise<LiveConnection> => {
    const existing = connectionRef.current;
    if (existing && existing.ws.readyState === WebSocket.OPEN) return existing;
    if (!selectedAgent) throw new Error("No agent selected");
    const handler = makeUpdateHandler();
    const { connection, ws } = await openInitializedConnection(
      selectedAgent,
      (update, updateSessionId, replayFor) => {
        const collector = collectorRef.current;
        if (
          collector &&
          updateSessionId === collector.sid &&
          replayFor === collector.token
        ) {
          collector.updates.push(update);
          return;
        }
        handler(update, updateSessionId);
      },
    );
    attachCloseHandler(ws);
    connectionRef.current = { connection, ws };
    return connectionRef.current;
  }, [selectedAgent, makeUpdateHandler, attachCloseHandler]);

  const loadChainRef = useRef<Promise<unknown>>(Promise.resolve());

  const runSessionLoad = useCallback(
    async (sid: string, replayBefore?: string): Promise<Message[]> => {
      const generation = generationRef.current;
      const live = await openConnection();
      const loadToken = crypto.randomUUID();
      const collector = { sid, token: loadToken, updates: [] as AcpUpdate[] };
      collectorRef.current = collector;
      let result: unknown;
      try {
        result = await live.connection.loadSession({
          sessionId: sid,
          cwd: ".",
          mcpServers: [],
          _meta: {
            platform:
              replayBefore !== undefined
                ? { replayBefore, loadToken }
                : { tail: true, loadToken },
          },
        });
      } finally {
        if (collectorRef.current === collector) collectorRef.current = null;
      }
      const platformMeta = (
        result as {
          _meta?: {
            platform?: {
              clipped?: unknown;
              turn?: unknown;
              undelivered?: unknown;
            };
          };
        } | null
      )?._meta?.platform;
      const clippedRaw = platformMeta?.clipped;
      const turn = platformReplayTurnMetaSchema.safeParse(platformMeta?.turn);
      const undelivered = platformUndeliveredMetaSchema.safeParse(
        platformMeta?.undelivered,
      );
      const clipped =
        clippedRaw === undefined
          ? null
          : platformClippedReplayMetaSchema.safeParse(clippedRaw);
      const updates: AcpUpdate[] =
        clipped?.success === true
          ? [
              {
                sessionUpdate: "platform_clipped_replay",
                ...(clipped.data.older !== undefined
                  ? { older: clipped.data.older }
                  : {}),
              },
              ...collector.updates,
            ]
          : collector.updates;
      const settled = settleReplay(
        updates.reduce<Message[]>(
          (acc, update) => applyUpdate(acc, update),
          [],
        ),
        { turnInFlight: turn.success && turn.data.inFlight },
      );
      const localKey = selectedAgent ? draftKey(selectedAgent, sid) : null;
      const held = localKey === null ? [] : readUndelivered(localKey);
      if (selectedAgent && localKey !== null && held.length > 0) {
        handOverUndelivered(selectedAgent, sid, held)
          .then(() => {
            clearUndelivered(localKey);
          })
          .catch(() => {});
      }
      const replayed = appendUndelivered(settled, [
        ...(undelivered.success ? undelivered.data : []),
        ...held,
      ]);
      if (replayBefore === undefined && generation === generationRef.current) {
        bindEngagement(sid);
        pendingReloadRef.current = false;
        setState("live");
      }
      return replayed;
    },
    [openConnection, bindEngagement, selectedAgent],
  );

  const loadSessionHistory = useCallback(
    (sid: string, replayBefore?: string): Promise<Message[]> => {
      const run = (): Promise<Message[]> => runSessionLoad(sid, replayBefore);
      const chained = loadChainRef.current.then(run, run);
      loadChainRef.current = chained.catch(() => {});
      return chained;
    },
    [runSessionLoad],
  );

  const ensureInner = useCallback(async (): Promise<LiveSession | null> => {
    if (!selectedAgent) return null;
    const generation = generationRef.current;

    const reloadSid = pendingReloadRef.current
      ? useStore.getState().sessionId
      : null;

    const live = await openConnection();
    if (generation !== generationRef.current) {
      try {
        live.ws.close();
      } catch {}
      return null;
    }

    if (reloadSid) {
      setState("reloading");
      const fresh = await loadSessionHistory(reloadSid);
      if (useStore.getState().sessionId !== reloadSid) return null;
      setMessages((prev) => mergeLocalFailures(fresh, prev));
    }

    const engagedSessionId = await engage(live.connection);
    if (!engagedSessionId || generation !== generationRef.current) return null;
    setState("live");
    return {
      connection: live.connection,
      sessionId: engagedSessionId,
      isOpen: () => live.ws.readyState === WebSocket.OPEN,
    };
  }, [selectedAgent, openConnection, loadSessionHistory, engage, setMessages]);

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

  useEffect(() => {
    reconnectFnRef.current = () => {
      if (!isMountedRef.current) return;
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

  useEffect(() => {
    reconnectAttemptRef.current = 0;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, [sessionId, selectedAgent]);

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
    startInFlightRef.current = null;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    reconnectAttemptRef.current = 0;
    setState("idle");
  }, [clearEngagement]);

  useEffect(() => {
    if (sessionId && sessionMode !== SessionMode.Terminal) return;
    reset();
  }, [sessionId, sessionMode, reset]);

  return {
    state,
    ensureLive,
    beginSession,
    loadSessionHistory,
    connectionRef,
    reset,
  };
}
