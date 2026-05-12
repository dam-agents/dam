import "@xterm/xterm/css/xterm.css";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import { decodeFrame, encodeDataFrame, encodeResize, OP_EXIT, OP_INPUT, OP_OUTPUT } from "api-server-api";
import { Loader2, TerminalIcon, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { getAccessToken } from "../../../auth.js";

type ConnectionState = "connecting" | "live" | "disconnected" | "exited";

export function Terminal({ instanceId, sessionId, fresh, onConnected }: { instanceId: string; sessionId: string; fresh?: boolean; onConnected?: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const [state, setState] = useState<ConnectionState>("connecting");
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [reconnectKey, setReconnectKey] = useState(0);
  const handleReconnect = useCallback(() => {
    setState("connecting");
    setReconnectKey((k) => k + 1);
  }, []);

  // After React commits "live" the connecting overlay unmounts; refocus then.
  useEffect(() => {
    if (state === "live") requestAnimationFrame(() => termRef.current?.focus());
  }, [state]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let ws: WebSocket | null = null;
    let term: XTerm | null = null;
    let ro: ResizeObserver | null = null;

    (async () => {
      term = new XTerm({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
        theme: { background: "#0c0a09", foreground: "#e7e5e4", cursor: "#e7e5e4", selectionBackground: "#44403c" },
        scrollback: 1000,
      });
      term.open(container);
      termRef.current = term;

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      // Wait one frame so the container has its committed layout before fit().
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      if (cancelled) return;
      fitAddon.fit();

      const token = await getAccessToken();
      if (cancelled) return;

      ws = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/instances/${instanceId}/terminal?token=${encodeURIComponent(token)}&sessionId=${encodeURIComponent(sessionId)}${fresh ? "&reset=1" : ""}`);
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        if (cancelled || !ws || !term) return;
        setState("live");
        ws.send(encodeResize(term.cols, term.rows).buffer);
        term.focus();
        onConnected?.();
      };

      ws.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        let frame;
        try { frame = decodeFrame(new Uint8Array(e.data)); } catch { return; }
        if (frame.op === OP_OUTPUT) term?.write(new TextDecoder().decode(frame.data));
        else if (frame.op === OP_EXIT) {
          setExitCode(frame.code);
          setState("exited");
        }
      };

      ws.onclose = () => {
        if (!cancelled) setState((s) => (s === "exited" ? s : "disconnected"));
      };
      ws.onerror = () => { if (!cancelled) setState("disconnected"); };

      term.onData((data) => {
        if (ws?.readyState === WebSocket.OPEN) ws.send(encodeDataFrame(OP_INPUT, data));
      });
      term.onResize(({ cols, rows }) => {
        if (ws?.readyState === WebSocket.OPEN) ws.send(encodeResize(cols, rows).buffer);
      });

      ro = new ResizeObserver(() => fitAddon.fit());
      ro.observe(container);
    })().catch((err) => {
      console.error("[terminal] connect failed:", err);
      setState("disconnected");
    });

    return () => {
      cancelled = true;
      ro?.disconnect();
      ws?.close();
      term?.dispose();
      termRef.current = null;
      container.innerHTML = "";
    };
    // `fresh` and `onConnected` are intentionally captured once at mount.
    // `reconnectKey` triggers a full teardown+reconnect cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, sessionId, reconnectKey]);

  return (
    <div className="flex flex-1 flex-col min-h-0 relative">
      {state === "connecting" && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-bg/80 backdrop-blur-sm">
          <div className="flex items-center gap-3 text-[14px] text-text-muted">
            <Loader2 size={18} className="animate-spin" />
            Connecting terminal...
          </div>
        </div>
      )}
      {state === "disconnected" && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-bg/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 text-center">
            <XCircle size={24} className="text-danger" />
            <p className="text-[14px] text-text-secondary">Session disconnected</p>
            <button
              className="rounded-md border border-border-light bg-surface-raised px-4 py-2 text-[13px] text-text-primary hover:bg-surface-hover transition-colors"
              onClick={handleReconnect}
            >
              Reconnect
            </button>
          </div>
        </div>
      )}
      {state === "exited" && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
          <div className="flex items-center gap-2 rounded-full border border-border-light bg-surface-raised px-4 py-2 text-[12px] text-text-muted shadow-md">
            <TerminalIcon size={14} />
            Process exited with code {exitCode}
          </div>
        </div>
      )}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 bg-[#0c0a09] p-1"
        onClick={() => termRef.current?.focus()}
      />
    </div>
  );
}
