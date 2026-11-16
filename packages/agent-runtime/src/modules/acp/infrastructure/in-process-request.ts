import type { ClientChannel } from "./client-channel.js";

interface JsonRpcResponseFrame {
  id: number;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

function describeError(
  error: NonNullable<JsonRpcResponseFrame["error"]>,
): string {
  const { data } = error;
  const detail =
    typeof data === "string"
      ? data
      : data && typeof data === "object"
        ? ((data as { message?: unknown; details?: unknown }).message ??
          (data as { details?: unknown }).details ??
          JSON.stringify(data))
        : undefined;
  const message = error.message ?? JSON.stringify(error);
  return typeof detail === "string" && detail !== "" && detail !== message
    ? `${message}: ${detail}`
    : message;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a request the runtime answered with an error. It
 * keeps the error's `code` and `data`, which a caller acts on: a harness's
 * resource-not-found code, and the `platform.unstored` the runtime puts on a
 * failed load of a Session it flagged unstored.
 */
export class InProcessRequestError extends Error {
  constructor(
    message: string,
    readonly code: number | undefined,
    readonly data: unknown,
  ) {
    super(message);
    this.name = "InProcessRequestError";
  }
}

export interface InProcessCaller {
  request<T>(method: string, params: unknown): Promise<T>;
  notify(method: string, params: unknown): void;
  // UNIT_BOUNDARY_DESCRIPTION: a JSON-RPC notification, with no id, for a method the protocol defines as one (session/cancel); notify carries an id, which the runtime schedules as a request.
  signal(method: string, params: unknown): void;
  close(): void;
}

export function createInProcessCaller(
  attach: (channel: InMemoryChannel) => void,
): InProcessCaller {
  const channel = createInMemoryChannel();
  const pending = new Map<number, (frame: JsonRpcResponseFrame) => void>();
  let nextId = 1;

  channel.onServerMessage((line) => {
    let frame: unknown;
    try {
      frame = JSON.parse(line);
    } catch {
      return;
    }
    if (
      !frame ||
      typeof frame !== "object" ||
      !("id" in frame) ||
      typeof (frame as { id: unknown }).id !== "number" ||
      !("result" in frame || "error" in frame)
    ) {
      return;
    }
    const response = frame as JsonRpcResponseFrame;
    const handler = pending.get(response.id);
    if (!handler) return;
    pending.delete(response.id);
    handler(response);
  });

  channel.onEnd(() => {
    for (const [id, handler] of [...pending]) {
      pending.delete(id);
      handler({
        id,
        error: {
          message: "the runtime closed the connection before answering",
        },
      });
    }
  });

  attach(channel);

  return {
    request<T>(method: string, params: unknown): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const id = nextId++;
        pending.set(id, (frame) => {
          if (frame.error) {
            reject(
              new InProcessRequestError(
                `${method} failed: ${describeError(frame.error)}`,
                frame.error.code,
                frame.error.data,
              ),
            );
            return;
          }
          resolve(frame.result as T);
        });
        channel.sendToServer(
          JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        );
      });
    },
    notify(method: string, params: unknown) {
      const id = nextId++;
      channel.sendToServer(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      );
    },
    signal(method: string, params: unknown) {
      channel.sendToServer(JSON.stringify({ jsonrpc: "2.0", method, params }));
    },
    close() {
      channel.close();
    },
  };
}

interface InMemoryChannel extends ClientChannel {
  sendToServer(line: string): void;
  onServerMessage(handler: (line: string) => void): void;
  onEnd(handler: () => void): void;
}

function createInMemoryChannel(): InMemoryChannel {
  let open = true;
  let clientMessageHandler: ((data: string) => void) | null = null;
  let closeHandler: (() => void) | null = null;
  let serverMessageHandler: ((line: string) => void) | null = null;
  let endHandler: (() => void) | null = null;

  return {
    send(line) {
      if (open) serverMessageHandler?.(line);
    },
    close() {
      if (!open) return;
      open = false;
      closeHandler?.();
      endHandler?.();
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
    onEnd(handler) {
      endHandler = handler;
    },
  };
}
