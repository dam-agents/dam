import WebSocket from "ws";
import {
  decodeFrame,
  encodeDataFrame,
  encodeResize,
  OP_EXIT,
  OP_INPUT,
  OP_OUTPUT,
} from "api-server-api";

export type BridgeResult =
  | { kind: "exited"; code: number }
  | { kind: "disconnected"; reason: string };

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
    const base = host.replace(/^https?:\/\//, "");
    const sep = terminalPath.includes("?") ? "&" : "?";
    const ws = new WebSocket(
      `${proto}//${base}${terminalPath}${sep}token=${encodeURIComponent(token)}`,
    );

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
