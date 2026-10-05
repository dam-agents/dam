import { useCallback, useEffect, useRef, useState } from "react";

import { getAccessToken } from "../../../auth.js";
import {
  createLatencyMeter,
  type FrameMetadata,
  parseBinaryFrame,
  parseStreamMessage,
  viewportFor,
} from "../lib/stream.js";

const LIVE_FPS = 30;
const HIDDEN_FPS = 1;
const STATS_INTERVAL_MS = 500;
const RESIZE_DEBOUNCE_MS = 250;
const CLEARED_CLOSE_CODE = 1012;
const RECONNECT_DELAY_MS = 1_000;
const RECONNECT_ATTEMPTS = 3;

export type BrowserStreamState = "connecting" | "live" | "disconnected";

export interface BrowserStats {
  roundTripMs: number | null;
  fps: number;
  kbPerSec: number;
}

export function useBrowserStream(
  agentId: string,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
) {
  const wsRef = useRef<WebSocket | null>(null);
  const meterRef = useRef(createLatencyMeter());
  const deviceRef = useRef<FrameMetadata | null>(null);
  const [state, setState] = useState<BrowserStreamState>("connecting");
  const [pageUrl, setPageUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<BrowserStats>({
    roundTripMs: null,
    fps: 0,
    kbPerSec: 0,
  });
  const [connectKey, setConnectKey] = useState(0);
  const failedAttemptsRef = useRef(0);

  const send = useCallback((msg: object, isInput = false) => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return;
    if (isInput) meterRef.current.input(performance.now());
    ws.send(JSON.stringify(msg));
  }, []);

  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;

    const draw = async (jpeg: Blob) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const bitmap = await createImageBitmap(jpeg);
      if (cancelled) return bitmap.close();
      if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
      if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
    };

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const sendViewport = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      send({
        type: "resize",
        ...viewportFor(
          canvas.clientWidth,
          canvas.clientHeight,
          window.devicePixelRatio,
        ),
      });
    };
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(sendViewport, RESIZE_DEBOUNCE_MS);
    });
    if (canvasRef.current) resizeObserver.observe(canvasRef.current);

    const onVisibility = () =>
      send({
        type: "config",
        maxFps: document.hidden ? HIDDEN_FPS : LIVE_FPS,
      });

    void (async () => {
      setState("connecting");
      const token = await getAccessToken();
      if (cancelled) return;
      const scheme = location.protocol === "https:" ? "wss:" : "ws:";
      const maxFps = document.hidden ? HIDDEN_FPS : LIVE_FPS;
      ws = new WebSocket(
        `${scheme}//${location.host}/api/agents/${encodeURIComponent(agentId)}/browser?token=${encodeURIComponent(token)}&maxFps=${maxFps}&pacing=ack`,
      );
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;
      ws.onopen = () => {
        if (cancelled) return;
        setState("live");
        sendViewport();
      };
      ws.onmessage = (e: MessageEvent<string | ArrayBuffer>) => {
        if (e.data instanceof ArrayBuffer) {
          const frame = parseBinaryFrame(e.data);
          if (!frame) return;
          failedAttemptsRef.current = 0;
          meterRef.current.frame(performance.now(), frame.jpeg.size);
          deviceRef.current = frame.metadata;
          void draw(frame.jpeg).finally(() =>
            send({ type: "ack", seq: frame.seq }),
          );
          return;
        }
        const msg = parseStreamMessage(e.data);
        if (!msg) return;
        if (msg.type === "url") {
          setPageUrl(msg.url);
        } else {
          setError(msg.message);
        }
      };
      ws.onclose = (e) => {
        if (cancelled) return;
        if (e.code === CLEARED_CLOSE_CODE) return setConnectKey((k) => k + 1);
        failedAttemptsRef.current += 1;
        if (failedAttemptsRef.current > RECONNECT_ATTEMPTS)
          return setState("disconnected");
        setState("connecting");
        reconnectTimer = setTimeout(
          () => setConnectKey((k) => k + 1),
          RECONNECT_DELAY_MS,
        );
      };
      document.addEventListener("visibilitychange", onVisibility);
    })().catch(() => {
      if (!cancelled) setState("disconnected");
    });

    const statsTimer = setInterval(
      () => setStats(meterRef.current.stats(performance.now())),
      STATS_INTERVAL_MS,
    );

    return () => {
      cancelled = true;
      clearInterval(statsTimer);
      if (resizeTimer) clearTimeout(resizeTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      ws?.close();
      wsRef.current = null;
    };
  }, [agentId, canvasRef, connectKey, send]);

  return {
    state,
    pageUrl,
    error,
    stats,
    device: () => deviceRef.current,
    send,
    navigate: (url: string) => {
      setError(null);
      send({ type: "navigate", url }, true);
    },
    reload: () => send({ type: "reload" }, true),
    back: () => send({ type: "back" }, true),
    forward: () => send({ type: "forward" }, true),
    clearData: () => send({ type: "clear_data" }),
    reconnect: () => {
      failedAttemptsRef.current = 0;
      setConnectKey((k) => k + 1);
    },
  };
}
