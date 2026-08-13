import { WebSocket } from "ws";
import type { WrapperFrameSender } from "../services/approvals-service.js";

export interface CreateWrapperFrameSenderDeps {
  resolveWrapperUrl(agentId: string): string;
  connectTimeoutMs?: number;
}

export function createWrapperFrameSender(
  deps: CreateWrapperFrameSenderDeps,
): WrapperFrameSender {
  const connectTimeoutMs = deps.connectTimeoutMs ?? 5000;
  return {
    async send(agentId, frame) {
      const url = deps.resolveWrapperUrl(agentId);
      const ws = new WebSocket(url);
      try {
        await waitForOpen(ws, connectTimeoutMs);
        await sendAndDrain(ws, frame);
      } finally {
        if (
          ws.readyState === WebSocket.OPEN ||
          ws.readyState === WebSocket.CONNECTING
        ) {
          ws.close();
        }
      }
    },
  };
}

function waitForOpen(ws: WebSocket, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeAllListeners();
      reject(new Error("wrapper WS connect timeout"));
    }, timeoutMs);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function sendAndDrain(ws: WebSocket, frame: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.send(frame, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
