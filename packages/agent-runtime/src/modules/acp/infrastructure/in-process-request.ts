import { createInMemoryChannel } from "./in-memory-channel.js";

interface JsonRpcResponseFrame {
  id: number;
  result?: unknown;
  error?: { code?: number; message?: string };
}

export interface InProcessCaller {
  request<T>(method: string, params: unknown): Promise<T>;
  notify(method: string, params: unknown): void;
  close(): void;
}

export function createInProcessCaller(
  attach: (channel: ReturnType<typeof createInMemoryChannel>) => void,
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

  attach(channel);

  return {
    request<T>(method: string, params: unknown): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const id = nextId++;
        pending.set(id, (frame) => {
          if (frame.error) {
            reject(
              new Error(
                `${method} failed: ${frame.error.message ?? JSON.stringify(frame.error)}`,
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
    close() {
      channel.close();
    },
  };
}
