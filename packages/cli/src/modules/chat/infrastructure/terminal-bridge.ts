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
import { wsUrl } from "../../shared/ws-url.js";
import {
  createTitleFilter,
  setTitle,
  TITLE_RESTORE,
  TITLE_SAVE,
} from "./terminal-title.js";

export type BridgeResult =
  { kind: "exited"; code: number } | { kind: "disconnected"; reason: string };

export const TERMINAL_MODE_RESET =
  "\x1b[<u" +
  "\x1b[?1049l" +
  "\x1b[?1000;1002;1003;1005;1006;1015;1016l" +
  "\x1b[?1004l" +
  "\x1b[?2004l" +
  "\x1b[?25h" +
  "\x1b[0m";

export function connectTerminalBridge({
  host,
  token,
  terminalPath,
  stdin,
  stdout,
  title,
}: {
  host: string;
  token: string;
  terminalPath: string;
  stdin: NodeJS.ReadStream & { setRawMode?(mode: boolean): void };
  stdout: NodeJS.WriteStream;
  /** Window title held for the whole connection; the remote's own titles are dropped. */
  title?: string;
}): Promise<BridgeResult> {
  return new Promise<BridgeResult>((resolve) => {
    let settled = false;
    const filter = title === undefined ? undefined : createTitleFilter();
    const url = wsUrl(host, terminalPath, token);
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
      if (title !== undefined) stdout.write(TITLE_RESTORE);
      stdout.write(TERMINAL_MODE_RESET);
      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      )
        ws.close();
      resolve(result);
    };

    ws.on("open", () => {
      if (title !== undefined) stdout.write(TITLE_SAVE + setTitle(title));
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
      if (frame.op === OP_OUTPUT)
        stdout.write(filter ? filter(frame.data) : Buffer.from(frame.data));
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
