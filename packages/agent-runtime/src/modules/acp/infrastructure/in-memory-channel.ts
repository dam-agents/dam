import type { ClientChannel } from "./client-channel.js";

/**
 * In-process `ClientChannel` adapter (ADR-052). Lets components inside
 * the agent-runtime (e.g. the trigger event handler) drive the
 * `AcpRuntime` via the same channel protocol the external WebSocket
 * client uses — no localhost socket, no transport.
 *
 * Two surfaces:
 *   - `ClientChannel` (the `AcpRuntime` consumes this): `send`, `close`,
 *     `isOpen`, `onMessage`, `onClose`.
 *   - Driver-side: `sendToServer(line)` to push a client→server frame,
 *     `onServerMessage(handler)` to receive server→client frames.
 *
 * Frames are JSON-RPC strings, same wire shape the WS channel carries.
 */
export interface InMemoryChannel extends ClientChannel {
  /** Driver-side: deliver a frame to the AcpRuntime as if from a remote client. */
  sendToServer(line: string): void;
  /** Driver-side: subscribe to frames the AcpRuntime sends back. */
  onServerMessage(handler: (line: string) => void): void;
}

export function createInMemoryChannel(): InMemoryChannel {
  let open = true;
  let clientMessageHandler: ((data: string) => void) | null = null;
  let closeHandler: (() => void) | null = null;
  let serverMessageHandler: ((line: string) => void) | null = null;

  return {
    send(line) {
      if (open) serverMessageHandler?.(line);
    },
    close() {
      if (!open) return;
      open = false;
      closeHandler?.();
    },
    isOpen() {
      return open;
    },
    onMessage(handler) {
      clientMessageHandler = handler;
    },
    onClose(handler) {
      closeHandler = handler;
    },
    sendToServer(line) {
      if (open) clientMessageHandler?.(line);
    },
    onServerMessage(handler) {
      serverMessageHandler = handler;
    },
  };
}
