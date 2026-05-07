import { WebSocket } from "ws";

import type { PromptEnvelope } from "../domain/types.js";

/** Function the consumer-group worker calls per stream entry. */
export type ForwardPrompt = (envelope: PromptEnvelope) => Promise<void>;

export interface CreateWrapperPromptForwarderDeps {
  /** Resolve an instance to the wrapper's ACP WebSocket URL. The composition
   *  root injects this — keeps prompts out of pod-networking details. */
  resolveWrapperUrl(instanceId: string): string;
  /** How long to wait for the WS to OPEN before failing. Failure leaves the
   *  stream entry unacked, so XAUTOCLAIM picks it up on the next loop. */
  connectTimeoutMs?: number;
}

/**
 * Opens a one-shot WebSocket to the wrapper, sends a single `session/prompt`
 * JSON-RPC request frame stamped with `_meta.promptId`, and closes.
 *
 * Fire-and-forget on purpose: ACP prompt responses can take minutes, and
 * holding the WS for the full prompt duration would tie one consumer slot
 * to one in-flight prompt. The wrapper's runtime processes the inbound
 * frame synchronously on receipt — TCP delivery order guarantees the data
 * frame is read before the close frame, so closing immediately after the
 * send-callback is safe. The wrapper records this (closing) channel as the
 * active prompt's owner; it nullifies our reference on detach but keeps
 * the prompt running. Other engaged channels (the UI's WS) receive the
 * synthesized `user_message_chunk` and the eventual `platform_turn_ended`
 * via the wrapper's existing fan-out.
 */
export function createWrapperPromptForwarder(
  deps: CreateWrapperPromptForwarderDeps,
): ForwardPrompt {
  const connectTimeoutMs = deps.connectTimeoutMs ?? 10_000;
  return async function forwardPrompt(envelope) {
    const url = deps.resolveWrapperUrl(envelope.instanceId);
    const ws = new WebSocket(url);
    try {
      await waitForOpen(ws, connectTimeoutMs);
      const frame = JSON.stringify({
        jsonrpc: "2.0",
        // Wrapper-side response (if any) lands at our about-to-close
        // channel, where it's silently dropped — id only needs to be a
        // valid JSON-RPC value.
        id: 1,
        method: "session/prompt",
        params: {
          sessionId: envelope.sessionId,
          prompt: envelope.prompt,
          _meta: { promptId: envelope.promptId },
        },
      });
      await sendAndDrain(ws, frame);
    } finally {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    }
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
