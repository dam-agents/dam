import WebSocket from "ws";

import { proxyAgentForUrl } from "../../shared/ws-proxy.js";

export function connectRawBridge({
  host,
  token,
  agentId,
  stdin,
  stdout,
}: {
  host: string;
  token: string;
  agentId: string;
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
}): Promise<number> {
  return new Promise<number>((resolve) => {
    let settled = false;
    const proto = host.startsWith("https://") ? "wss:" : "ws:";
    const base = host.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    const url = `${proto}//${base}/api/agents/${encodeURIComponent(agentId)}/ssh?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url, { agent: proxyAgentForUrl(url) });
    ws.binaryType = "nodebuffer";

    const onStdin = (chunk: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(chunk, { binary: true });
    };
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      stdin.off("data", onStdin);
      stdin.pause();
      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      )
        ws.close();
      resolve(code);
    };

    ws.on("open", () => {
      stdin.on("data", onStdin);
      stdin.on("end", () => finish(0));
      stdin.resume();
    });
    ws.on("message", (data: Buffer) => stdout.write(data));
    ws.on("close", (code) => finish(code === 1000 || code === 1005 ? 0 : 1));
    ws.on("error", () => finish(1));
  });
}
