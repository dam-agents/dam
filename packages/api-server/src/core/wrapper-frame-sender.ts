import { WebSocket } from "ws";

/**
 * Cross-module port for delivering a single JSON-RPC frame to a wrapper
 * (agent-runtime) over its ACP WebSocket. Used by:
 *
 *   - approvals — inbox resolve sends a permission response inline; the
 *     delivery sweeper retries undelivered rows on a tick.
 *   - prompts — the durable-prompt forwarder ships `session/prompt`
 *     envelopes after an XREADGROUP pop.
 *
 * The wrapper deduplicates incoming responses by JSON-RPC id and silently
 * drops anything that isn't pending, so concurrent / retried sends are
 * harmless on the wire.
 */
export interface WrapperFrameSender {
  send(instanceId: string, frame: string): Promise<void>;
}

export interface CreateWrapperFrameSenderDeps {
  /** Resolve an instance to the wrapper's ACP WebSocket URL. The composition
   *  root injects this — keeps the sender out of pod-networking details. */
  resolveWrapperUrl(instanceId: string): string;
  /** How long to wait for the WS to OPEN before failing. Failure surfaces
   *  to the caller; both consumers (approvals sweep, prompts forwarder)
   *  retry on their own cadence. */
  connectTimeoutMs?: number;
}

/**
 * Opens a one-shot WebSocket to the wrapper, sends a single JSON-RPC frame,
 * and closes. Frame construction is the caller's job — the sender is a
 * neutral pipe.
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
