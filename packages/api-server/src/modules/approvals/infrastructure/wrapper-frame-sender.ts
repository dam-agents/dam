import { WebSocket } from "ws";
import type { WrapperFrameSender } from "../services/approvals-service.js";

export interface CreateWrapperFrameSenderDeps {
  /** Resolve an instance to the wrapper's ACP WebSocket URL. The composition
   *  root injects this — keeps approvals out of pod-networking details. */
  resolveWrapperUrl(instanceId: string): string;
  /** How long to wait for the WS to OPEN before failing. */
  connectTimeoutMs?: number;
}

/**
 * Opens a one-shot WebSocket to the wrapper, sends a single JSON-RPC
 * response frame, and closes. Used by the inline delivery path on inbox
 * resolve and by the periodic sweep that retries undelivered rows.
 *
 * Idempotent at the wrapper: it matches incoming responses against its
 * `pendingFromAgent` map by JSON-RPC id and silently drops anything that
 * isn't pending. So if the inline send and a sweep retry race, the second
 * delivery is harmless.
 */
export function createWrapperFrameSender(
  deps: CreateWrapperFrameSenderDeps,
): WrapperFrameSender {
  const connectTimeoutMs = deps.connectTimeoutMs ?? 5000;
  return {
    async send(instanceId, frame) {
      const url = deps.resolveWrapperUrl(instanceId);
      const ws = new WebSocket(url);
      try {
        await waitForOpen(ws, connectTimeoutMs);
        await sendAndDrain(ws, frame);
      } finally {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
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
