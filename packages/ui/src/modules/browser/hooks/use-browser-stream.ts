import { useCallback, useEffect, useRef, useState } from "react";

import { getAccessToken } from "../../../auth.js";
import {
  createLatencyMeter,
  type FrameMetadata,
  parseBinaryFrame,
  parseStreamMessage,
  type StreamInfo,
  viewportDiffers,
  viewportFor,
} from "../lib/stream.js";
import {
  createVideoPlayer,
  type VideoPlayer,
  videoSupported,
} from "../lib/video.js";

const STATS_INTERVAL_MS = 500;
const RESIZE_DEBOUNCE_MS = 250;
const VIEWPORT_RESEND_MS = 1_000;
const CLEARED_CLOSE_CODE = 1012;
const RECONNECT_DELAY_MS = 1_000;
const RECONNECT_ATTEMPTS = 3;
const ERROR_SHOWN_MS = 6_000;

export type BrowserStreamState =
  "connecting" | "live" | "disconnected" | "unsupported";

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
  const [streamInfo, setStreamInfo] = useState<StreamInfo | null>(null);
  const [stats, setStats] = useState<BrowserStats>({
    roundTripMs: null,
    fps: 0,
    kbPerSec: 0,
  });
  const [connectKey, setConnectKey] = useState(0);
  const failedAttemptsRef = useRef(0);
  const pendingUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), ERROR_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [error]);

  const send = useCallback((msg: object, isInput = false) => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return;
    if (isInput) meterRef.current.input(performance.now());
    ws.send(JSON.stringify(msg));
  }, []);

  const navigate = useCallback(
    (url: string) => {
      setError(null);
      if (wsRef.current?.readyState === WebSocket.OPEN)
        send({ type: "navigate", url }, true);
      else pendingUrlRef.current = url;
    },
    [send],
  );

  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;
    let player: VideoPlayer | null = null;
    let lastChunkBytes = 0;

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let viewportSentAt = 0;
    const wantedViewport = () => {
      const canvas = canvasRef.current;
      if (!canvas || canvas.clientWidth === 0 || canvas.clientHeight === 0)
        return null;
      return viewportFor(
        canvas.clientWidth,
        canvas.clientHeight,
        window.devicePixelRatio,
      );
    };
    const sendViewport = () => {
      const wanted = wantedViewport();
      if (!wanted) return;
      viewportSentAt = performance.now();
      send({ type: "resize", ...wanted });
    };
    const snapViewport = (device: FrameMetadata) => {
      if (document.hidden || !document.hasFocus()) return;
      const wanted = wantedViewport();
      if (!wanted || !viewportDiffers(device, wanted)) return;
      if (performance.now() - viewportSentAt < VIEWPORT_RESEND_MS) return;
      sendViewport();
    };
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(sendViewport, RESIZE_DEBOUNCE_MS);
    });
    if (canvasRef.current) resizeObserver.observe(canvasRef.current);

    void (async () => {
      setState("connecting");
      if (!(await videoSupported())) {
        if (!cancelled) setState("unsupported");
        return;
      }
      const token = await getAccessToken();
      if (cancelled) return;
      const scheme = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(
        `${scheme}//${location.host}/api/agents/${encodeURIComponent(agentId)}/browser?token=${encodeURIComponent(token)}`,
      );
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;
      ws.onopen = () => {
        if (cancelled) return;
        setState("live");
        sendViewport();
        if (pendingUrlRef.current) {
          send({ type: "navigate", url: pendingUrlRef.current }, true);
          pendingUrlRef.current = null;
        }
      };
      ws.onmessage = (e: MessageEvent<string | ArrayBuffer>) => {
        if (e.data instanceof ArrayBuffer) {
          const frame = parseBinaryFrame(e.data);
          if (!frame) return;
          failedAttemptsRef.current = 0;
          deviceRef.current = frame.metadata;
          snapViewport(frame.metadata);
          lastChunkBytes = frame.data.byteLength;
          player ??= createVideoPlayer({
            canvas: () => canvasRef.current,
            onDrawn: () =>
              meterRef.current.frame(performance.now(), lastChunkBytes),
            onError: () => {
              player?.close();
              player = null;
              ws?.close();
            },
          });
          player.decode(frame);
          return;
        }
        const msg = parseStreamMessage(e.data);
        if (!msg) return;
        if (msg.type === "url") setPageUrl(msg.url);
        else if (msg.type === "stream_info") setStreamInfo(msg);
        else setError(msg.message);
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
      window.addEventListener("focus", sendViewport);
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
      window.removeEventListener("focus", sendViewport);
      ws?.close();
      player?.close();
      wsRef.current = null;
    };
  }, [agentId, canvasRef, connectKey, send]);

  return {
    state,
    pageUrl,
    error,
    stats,
    streamInfo,
    device: () => deviceRef.current,
    send,
    navigate,
    reload: () => send({ type: "reload" }, true),
    back: () => send({ type: "back" }, true),
    forward: () => send({ type: "forward" }, true),
    clearData: () => send({ type: "clear_data" }),
    restartBrowser: () => send({ type: "restart_browser" }),
    reconnect: () => {
      failedAttemptsRef.current = 0;
      setConnectKey((k) => k + 1);
    },
  };
}
