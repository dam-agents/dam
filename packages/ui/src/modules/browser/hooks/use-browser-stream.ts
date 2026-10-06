import { useCallback, useEffect, useRef, useState } from "react";

import { getAccessToken } from "../../../auth.js";
import {
  type BrowserState,
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
const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 5_000, 10_000];
const GIVE_UP_NOTICE_AFTER = 3;
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
  video = true,
) {
  const wsRef = useRef<WebSocket | null>(null);
  const meterRef = useRef(createLatencyMeter());
  const deviceRef = useRef<FrameMetadata | null>(null);
  const [state, setState] = useState<BrowserStreamState>("connecting");
  const [pageUrl, setPageUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [streamInfo, setStreamInfo] = useState<StreamInfo | null>(null);
  const [browser, setBrowser] = useState<{
    state: BrowserState;
    message: string | null;
  }>({ state: "starting", message: null });
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
      const box = canvasRef.current?.parentElement;
      if (!box || box.clientWidth === 0 || box.clientHeight === 0) return null;
      return viewportFor(
        box.clientWidth,
        box.clientHeight,
        window.devicePixelRatio,
      );
    };
    const sendViewport = () => {
      if (!video) return;
      const wanted = wantedViewport();
      if (!wanted) return;
      viewportSentAt = performance.now();
      send({ type: "resize", ...wanted });
    };
    const snapViewport = (device: FrameMetadata) => {
      if (!video || document.hidden || !document.hasFocus()) return;
      const wanted = wantedViewport();
      if (!wanted || !viewportDiffers(device, wanted)) return;
      if (performance.now() - viewportSentAt < VIEWPORT_RESEND_MS) return;
      sendViewport();
    };
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(sendViewport, RESIZE_DEBOUNCE_MS);
    });
    const box = canvasRef.current?.parentElement;
    if (box) resizeObserver.observe(box);

    void (async () => {
      setState("connecting");
      if (video && !(await videoSupported())) {
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
        failedAttemptsRef.current = 0;
        setState("live");
        if (video) sendViewport();
        else send({ type: "no_video" });
        if (pendingUrlRef.current) {
          send({ type: "navigate", url: pendingUrlRef.current }, true);
          pendingUrlRef.current = null;
        }
      };
      ws.onmessage = (e: MessageEvent<string | ArrayBuffer>) => {
        if (e.data instanceof ArrayBuffer) {
          if (!video) return;
          const frame = parseBinaryFrame(e.data);
          if (!frame) return;
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
        else if (msg.type === "browser_state")
          setBrowser({ state: msg.state, message: msg.message });
        else setError(msg.message);
      };
      ws.onclose = (e) => {
        if (cancelled) return;
        if (e.code === 1011 && e.reason === "video unavailable")
          return setState("disconnected");
        failedAttemptsRef.current += 1;
        const attempt = failedAttemptsRef.current;
        setState(
          attempt > GIVE_UP_NOTICE_AFTER ? "disconnected" : "connecting",
        );
        reconnectTimer = setTimeout(
          () => setConnectKey((k) => k + 1),
          RECONNECT_DELAYS_MS[
            Math.min(attempt - 1, RECONNECT_DELAYS_MS.length - 1)
          ],
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
  }, [agentId, canvasRef, connectKey, send, video]);

  return {
    state,
    browser,
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
