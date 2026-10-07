import { useCallback, useEffect, useRef, useState } from "react";

import { getAccessToken } from "../../../auth.js";
import {
  type BrowserState,
  type PageState,
  parseControlMessage,
} from "../lib/control.js";

const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 5_000, 10_000];
const GIVE_UP_NOTICE_AFTER = 3;
const ERROR_SHOWN_MS = 6_000;

export type BrowserConnection =
  "connecting" | "live" | "disconnected" | "unavailable";

export function useBrowserControl(agentId: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connection, setConnection] = useState<BrowserConnection>("connecting");
  const [page, setPage] = useState<PageState>({
    url: "",
    title: "",
    loading: false,
    canGoBack: false,
    canGoForward: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [browser, setBrowser] = useState<{
    state: BrowserState;
    message: string | null;
  }>({ state: "starting", message: null });
  const [connectKey, setConnectKey] = useState(0);
  const [connects, setConnects] = useState(0);
  const failedAttemptsRef = useRef(0);
  const pendingUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), ERROR_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [error]);

  const send = useCallback((msg: object) => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(msg));
  }, []);

  const navigate = useCallback(
    (url: string) => {
      setError(null);
      setPage((p) => ({ ...p, url, loading: true }));
      if (wsRef.current?.readyState === WebSocket.OPEN)
        send({ type: "navigate", url });
      else pendingUrlRef.current = url;
    },
    [send],
  );

  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    void (async () => {
      setConnection("connecting");
      const token = await getAccessToken();
      if (cancelled) return;
      const scheme = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(
        `${scheme}//${location.host}/api/agents/${encodeURIComponent(agentId)}/browser?token=${encodeURIComponent(token)}`,
      );
      wsRef.current = ws;
      ws.onopen = () => {
        if (cancelled) return;
        failedAttemptsRef.current = 0;
        setConnection("live");
        setConnects((n) => n + 1);
        if (pendingUrlRef.current) {
          send({ type: "navigate", url: pendingUrlRef.current });
          pendingUrlRef.current = null;
        }
      };
      ws.onmessage = (e: MessageEvent<string>) => {
        if (typeof e.data !== "string") return;
        const msg = parseControlMessage(e.data);
        if (!msg) return;
        if (msg.type === "page")
          setPage({
            url: msg.url,
            title: msg.title,
            loading: msg.loading,
            canGoBack: msg.canGoBack,
            canGoForward: msg.canGoForward,
          });
        else if (msg.type === "browser_state")
          setBrowser({ state: msg.state, message: msg.message });
        else setError(msg.message);
      };
      ws.onclose = (e) => {
        if (cancelled) return;
        if (e.code === 1011 && e.reason === "display unavailable")
          return setConnection("unavailable");
        failedAttemptsRef.current += 1;
        const attempt = failedAttemptsRef.current;
        setConnection(
          attempt > GIVE_UP_NOTICE_AFTER ? "disconnected" : "connecting",
        );
        reconnectTimer = setTimeout(
          () => setConnectKey((k) => k + 1),
          RECONNECT_DELAYS_MS[
            Math.min(attempt - 1, RECONNECT_DELAYS_MS.length - 1)
          ],
        );
      };
    })().catch(() => {
      if (!cancelled) setConnection("disconnected");
    });

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
      wsRef.current = null;
    };
  }, [agentId, connectKey, send]);

  return {
    connection,
    connects,
    browser,
    page,
    error,
    navigate,
    reload: () => send({ type: "reload" }),
    stop: () => send({ type: "stop" }),
    back: () => send({ type: "back" }),
    forward: () => send({ type: "forward" }),
    clearData: () => send({ type: "clear_data" }),
    restartBrowser: () => send({ type: "restart_browser" }),
    reconnect: () => {
      failedAttemptsRef.current = 0;
      setConnectKey((k) => k + 1);
    },
  };
}
