import { WebSocket } from "ws";
import type { ClientChannel } from "./client-channel.js";

const HEARTBEAT_INTERVAL_MS = 30_000;

export function createWebSocketChannel(ws: WebSocket): ClientChannel {
  let alive = true;
  const pingInterval = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (!alive) {
      try {
        ws.terminate();
      } catch {}
      return;
    }
    alive = false;
    try {
      ws.ping();
    } catch {}
  }, HEARTBEAT_INTERVAL_MS);

  ws.on("pong", () => {
    alive = true;
  });
  ws.on("close", () => clearInterval(pingInterval));

  return {
    send(line) {
      if (ws.readyState === WebSocket.OPEN) ws.send(line);
    },
    close(code, reason) {
      try {
        ws.close(code, reason);
      } catch {}
    },
    isOpen() {
      return ws.readyState === WebSocket.OPEN;
    },
    onMessage(handler) {
      ws.on("message", (data: Buffer) => handler(data.toString()));
    },
    onClose(handler) {
      ws.on("close", handler);
    },
  };
}
