import "@xterm/xterm/css/xterm.css";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import { OP_EXIT, OP_INPUT, OP_OUTPUT, OP_RESIZE } from "api-server-api";
import { Loader2, TerminalIcon, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { getAccessToken } from "../../../auth.js";

type ConnectionState = "connecting" | "live" | "disconnected" | "exited";

/** Build the WebSocket URL for the terminal relay. */
async function terminalWsUrl(instanceId: string, sessionId: string): Promise<string> {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const token = await getAccessToken();
  return `${proto}//${location.host}/api/instances/${instanceId}/terminal?token=${encodeURIComponent(token)}&sessionId=${encodeURIComponent(sessionId)}`;
}

/** Encode a data frame: opcode byte + payload. */
function encodeData(op: number, data: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(data);
  const frame = new Uint8Array(1 + encoded.byteLength);
  frame[0] = op;
  frame.set(encoded, 1);
  return frame.buffer;
}

/** Encode a resize frame: opcode 0x02 + cols(u16BE) + rows(u16BE). */
function encodeResize(cols: number, rows: number): ArrayBuffer {
  const frame = new ArrayBuffer(5);
  const view = new DataView(frame);
  view.setUint8(0, OP_RESIZE);
  view.setUint16(1, cols);
  view.setUint16(3, rows);
  return frame;
}

export function Terminal({ instanceId, sessionId }: { instanceId: string; sessionId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [state, setState] = useState<ConnectionState>("connecting");
  const [exitCode, setExitCode] = useState<number | null>(null);

  const cleanup = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (termRef.current) {
      termRef.current.dispose();
      termRef.current = null;
    }
    fitRef.current = null;
    if (containerRef.current) {
      containerRef.current.innerHTML = "";
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;

    async function connect() {
      if (cancelled) return;
      setState("connecting");

      const term = new XTerm({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
        theme: {
          background: "#0c0a09",
          foreground: "#e7e5e4",
          cursor: "#e7e5e4",
          selectionBackground: "#44403c",
        },
        scrollback: 1000,
      });
      term.open(container!);
      termRef.current = term;

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      fitRef.current = fitAddon;

      // Wait for layout before fitting
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      if (cancelled) return;

      fitAddon.fit();

      // Connect WebSocket
      const url = await terminalWsUrl(instanceId, sessionId);
      if (cancelled) return;

      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) return;
        setState("live");
        ws.send(encodeResize(term.cols, term.rows));
        term.focus();
      };

      ws.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        const buf = new Uint8Array(e.data);
        if (buf.byteLength === 0) return;
        const op = buf[0];
        const payload = buf.subarray(1);

        switch (op) {
          case OP_OUTPUT: {
            const text = new TextDecoder().decode(payload);
            term.write(text);
            break;
          }
          case OP_EXIT:
            setExitCode(payload.byteLength > 0 ? payload[0]! : 0);
            setState("exited");
            break;
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        setState((s) => (s === "exited" ? s : "disconnected"));
      };

      ws.onerror = () => {
        if (cancelled) return;
        setState("disconnected");
      };

      // Wire terminal input → WebSocket
      term.onData((data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(encodeData(OP_INPUT, data));
        }
      });

      // Wire resize events
      term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(encodeResize(cols, rows));
        }
      });

      // Auto-fit terminal on container resize
      const ro = new ResizeObserver(() => {
        fitAddon.fit();
      });
      ro.observe(container!);

      return () => ro.disconnect();
    }

    const roCleanup = connect().catch((err) => {
      console.error("[terminal] connect failed:", err);
      setState("disconnected");
    });

    return () => {
      cancelled = true;
      roCleanup?.then((fn) => fn?.());
      cleanup();
    };
  }, [instanceId, sessionId, cleanup]);

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
            <p className="text-[14px] text-text-secondary">Terminal disconnected</p>
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
