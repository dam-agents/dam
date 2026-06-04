import type { ClientChannel } from "./client-channel.js";

export interface InMemoryChannel extends ClientChannel {
  sendToServer(line: string): void;
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
