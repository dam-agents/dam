import WebSocket from "ws";
import {
  decodeFrame,
  encodeDataFrame,
  encodeResize,
  OP_EXIT,
  OP_INPUT,
  OP_OUTPUT,
} from "api-server-api";

import { proxyAgentForUrl } from "../../shared/ws-proxy.js";

export type BridgeResult =
  | { kind: "exited"; code: number }
  | { kind: "disconnected"; reason: string };

// The remote TUI flips modes on the *local* terminal emulator (mouse tracking,
// bracketed paste, alt screen, kitty keyboard, hidden cursor) and can't restore
// them after an abrupt disconnect — without this the shell keeps receiving
// mouse-event garbage like `[<35;62;20M`. Terminals ignore sequences they
// don't support, so this is safe to emit unconditionally.
export const TERMINAL_MODE_RESET =
  "\x1b[<u" + // pop kitty keyboard protocol flags
  "\x1b[?1049l" + // leave alternate screen
  "\x1b[?1000;1002;1003;1005;1006;1015;1016l" + // mouse tracking off (all variants)
  "\x1b[?1004l" + // focus reporting off
  "\x1b[?2004l" + // bracketed paste off
  "\x1b[?25h" + // show cursor
  "\x1b[0m"; // reset SGR attributes

export function connectTerminalBridge({
  host,
  token,
  terminalPath,
  stdin,
  stdout,
}: {
  host: string;
  token: string;
  terminalPath: string;
  stdin: NodeJS.ReadStream & { setRawMode?(mode: boolean): void };
  stdout: NodeJS.WriteStream;
}): Promise<BridgeResult> {
  return new Promise<BridgeResult>((resolve) => {
    let settled = false;
    const proto = host.startsWith("https://") ? "wss:" : "ws:";
    const base = host.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    const sep = terminalPath.includes("?") ? "&" : "?";
    const url = `${proto}//${base}${terminalPath}${sep}token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url, { agent: proxyAgentForUrl(url) });

    const onData = (chunk: Buffer) => {
      if (ws.readyState === WebSocket.OPEN)
        ws.send(encodeDataFrame(OP_INPUT, new Uint8Array(chunk)));
    };
    const onResize = () => {
      if (ws.readyState === WebSocket.OPEN)
        ws.send(encodeResize(stdout.columns, stdout.rows));
    };

    const finish = (result: BridgeResult) => {
      if (settled) return;
      settled = true;
      stdin.off("data", onData);
      process.off("SIGWINCH", onResize);
      if (stdin.setRawMode)
        try {
          stdin.setRawMode(false);
        } catch {}
      stdin.pause();
      stdout.write(TERMINAL_MODE_RESET);
      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      )
        ws.close();
      resolve(result);
    };

    ws.on("open", () => {
      ws.send(encodeResize(stdout.columns, stdout.rows));
      if (stdin.setRawMode) stdin.setRawMode(true);
      stdin.resume();
      stdin.on("data", onData);
      process.on("SIGWINCH", onResize);
    });

    ws.on("message", (data: Buffer) => {
      let frame;
      try {
        frame = decodeFrame(new Uint8Array(data));
      } catch {
        return;
      }
      if (frame.op === OP_OUTPUT) stdout.write(Buffer.from(frame.data));
      else if (frame.op === OP_EXIT)
        finish({ kind: "exited", code: frame.code });
    });

    ws.on("close", (_code, reason) =>
      finish({
        kind: "disconnected",
        reason: reason?.toString() || "connection closed",
      }),
    );
    ws.on("error", (e) => finish({ kind: "disconnected", reason: e.message }));
  });
}
