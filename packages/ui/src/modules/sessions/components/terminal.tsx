import "@xterm/xterm/css/xterm.css";

import { ErrorFilled, Terminal as TerminalIcon } from "@carbon/icons-react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import {
  decodeFrame,
  encodeDataFrame,
  encodeResize,
  OP_EXIT,
  OP_INPUT,
  OP_OUTPUT,
} from "api-server-api";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

import { getAccessToken } from "../../../auth.js";
import { useTerminalReconnect } from "../hooks/use-terminal-reconnect.js";
import {
  followedSession,
  freshPty,
  terminalCloseDrop,
  terminalSocketUrl,
} from "../lib/terminal-socket.js";

type ConnectionState =
  "connecting" | "live" | "reconnecting" | "disconnected" | "exited";

export function Terminal({
  agentId,
  sessionId,
  fresh,
  onConnected,
  onFirstOutput,
  onFirstSubmit,
  onSubmit,
  onSessionMoved,
  autoConnect = true,
}: {
  agentId: string;
  sessionId: string;
  fresh?: boolean;
  onConnected?: () => void;
  onFirstOutput?: () => void;
  onFirstSubmit?: () => void;
  onSubmit?: () => void;
  onSessionMoved?: (sessionId: string) => void;
  autoConnect?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const [state, setState] = useState<ConnectionState>(
    autoConnect ? "connecting" : "disconnected",
  );
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [reconnectKey, setReconnectKey] = useState(0);
  const connectEnabled = useRef(autoConnect);
  const stopped = useRef(false);
  const automatic = useRef(false);
  const attachedTo = useRef(sessionId);
  const [pty] = useState(freshPty);
  const socket = useRef<WebSocket | null>(null);
  const retryConnect = useCallback(() => {
    if (stopped.current) return;
    if (!connectEnabled.current) {
      setState("disconnected");
      return;
    }
    automatic.current = true;
    setReconnectKey((k) => k + 1);
  }, []);
  const reconnect = useTerminalReconnect(retryConnect);
  const handleStopReconnect = () => {
    stopped.current = true;
    reconnect.stop();
    socket.current?.close();
    setState("disconnected");
  };
  const handleReconnect = () => {
    stopped.current = false;
    automatic.current = false;
    connectEnabled.current = true;
    setState("connecting");
    setReconnectKey((k) => k + 1);
  };

  useEffect(() => {
    const wasDisabled = !connectEnabled.current;
    connectEnabled.current = autoConnect;
    if (autoConnect && wasDisabled && !stopped.current) {
      setState("connecting");
      setReconnectKey((k) => k + 1);
    }
  }, [autoConnect]);

  useEffect(() => {
    if (state === "live") requestAnimationFrame(() => termRef.current?.focus());
  }, [state]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    const current = () => !cancelled && !stopped.current;
    let ws: WebSocket | null = null;
    let term: XTerm | null = null;
    let ro: ResizeObserver | null = null;
    let firstOutputSeen = false;
    let firstSubmitSeen = false;

    (async () => {
      term = new XTerm({
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
      term.open(container);
      termRef.current = term;

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      if (cancelled) return;
      fitAddon.fit();

      if (!connectEnabled.current || stopped.current) return;

      const token = await getAccessToken();
      if (!current()) return;

      const reset = pty.reset(Boolean(fresh));
      const wakes = !automatic.current;
      automatic.current = false;
      ws = new WebSocket(
        terminalSocketUrl({
          location,
          agentId,
          sessionId: attachedTo.current,
          token,
          reset,
          wakes,
        }),
      );
      ws.binaryType = "arraybuffer";
      socket.current = ws;
      let live = false;
      let exited = false;

      ws.onopen = () => {
        if (!current() || !ws || !term) return;
        setState((s) => (s === "reconnecting" ? s : "live"));
        ws.send(encodeResize(term.cols, term.rows).buffer);
        term.focus();
        onConnected?.();
      };

      ws.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        let frame;
        try {
          frame = decodeFrame(new Uint8Array(e.data));
        } catch {
          return;
        }
        if (!current()) return;
        if (!live) {
          live = true;
          pty.attached();
          reconnect.live();
          setState((s) => (s === "reconnecting" ? "live" : s));
        }
        const moved = followedSession(attachedTo.current, frame);
        if (moved !== attachedTo.current) {
          attachedTo.current = moved;
          onSessionMoved?.(moved);
        }
        if (frame.op === OP_OUTPUT) {
          if (!firstOutputSeen) {
            firstOutputSeen = true;
            onFirstOutput?.();
          }
          term?.write(new TextDecoder().decode(frame.data));
        } else if (frame.op === OP_EXIT) {
          exited = true;
          setExitCode(frame.code);
          setState("exited");
        }
      };

      ws.onclose = (e) => {
        if (cancelled || exited) return;
        const step = reconnect.dropped(
          terminalCloseDrop(e.code, e.reason),
          live,
        );
        if (step.kind === "retry") {
          setState("reconnecting");
          return;
        }
        setState("disconnected");
      };

      term.onData((data) => {
        if (/[\r\n]/.test(data)) {
          onSubmit?.();
          if (!firstSubmitSeen) {
            firstSubmitSeen = true;
            onFirstSubmit?.();
          }
        }
        if (ws?.readyState === WebSocket.OPEN)
          ws.send(encodeDataFrame(OP_INPUT, data));
      });
      term.onResize(({ cols, rows }) => {
        if (ws?.readyState === WebSocket.OPEN)
          ws.send(encodeResize(cols, rows).buffer);
      });

      ro = new ResizeObserver(() => fitAddon.fit());
      ro.observe(container);
    })().catch((err) => {
      console.error("[terminal] connect failed:", err);
      reconnect.stop();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, sessionId, reconnectKey]);

  return (
    <div className="flex flex-1 flex-col min-h-0 relative">
      {state === "connecting" && (
        <div className="absolute inset-0 z-content flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Spinner size={18} />
            Connecting terminal...
          </div>
        </div>
      )}
      {state === "reconnecting" && (
        <div className="absolute inset-0 z-content flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Spinner size={18} />
              Reconnecting terminal…
            </div>
            {reconnect.status && (
              <p className="text-xs text-muted-foreground">
                {reconnect.status.reason} · attempt {reconnect.status.attempt}
              </p>
            )}
            <Button variant="outline" onClick={handleStopReconnect}>
              Stop
            </Button>
          </div>
        </div>
      )}
      {state === "disconnected" && (
        <div className="absolute inset-0 z-content flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 text-center">
            <ErrorFilled size={24} className="text-danger" />
            <p className="text-sm text-muted-foreground">
              Session disconnected
            </p>
            <Button variant="outline" onClick={handleReconnect}>
              Reconnect
            </Button>
          </div>
        </div>
      )}
      {state === "exited" && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-content">
          <div className="flex items-center gap-2 rounded-full border border-border bg-muted px-4 py-2 text-xs text-muted-foreground shadow-md">
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
