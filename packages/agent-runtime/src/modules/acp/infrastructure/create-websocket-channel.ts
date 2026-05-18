import { WebSocket } from "ws";
import type { ClientChannel } from "./client-channel.js";

/**
 * How often we ping. A peer that goes silent for longer than this without
 * FIN'ing the socket (laptop lid closed, NAT drop) gets reaped on the next
 * tick, so in the worst case a dead connection lingers for 2 × interval.
 */
const HEARTBEAT_INTERVAL_MS = 30_000;

export function createWebSocketChannel(ws: WebSocket): ClientChannel {
  let alive = true;
  const pingInterval = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (!alive) {
      try {
        ws.terminate();
      } catch {
        /* already gone */
      }
      return;
    }
    alive = false;
    try {
      ws.ping();
    } catch {
      /* send buffer full or already closing */
    }
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
      } catch {
        // ignore — channel is closing anyway
      }
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
