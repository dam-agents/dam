import { createInMemoryChannel } from "../infrastructure/in-memory-channel.js";
import type { AcpRuntime } from "./acp-runtime.js";

export interface TriggerSessionDriver {
  start(opts: {
    task: string;
    mcpServers?: unknown[];
    resumeSessionId?: string;
  }): Promise<{ sessionId: string }>;
}

interface JsonRpcResponseFrame {
  id: number;
  result?: unknown;
  error?: { code?: number; message?: string };
}

export function createTriggerSessionDriver(deps: {
  acpRuntime: AcpRuntime;
}): TriggerSessionDriver {
  return {
    async start({ task, mcpServers, resumeSessionId }) {
      const channel = createInMemoryChannel();
      let nextId = 1;
      const pending = new Map<number, (frame: JsonRpcResponseFrame) => void>();

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

      function request<T>(method: string, params: unknown): Promise<T> {
        return new Promise((resolve, reject) => {
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
      }

      function sendFireAndForget(method: string, params: unknown): void {
        const id = nextId++;
        channel.sendToServer(
          JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        );
      }

      deps.acpRuntime.attach(channel);

      try {
        await request("initialize", {
          protocolVersion: 1,
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: true },
          },
          clientInfo: { name: "platform-trigger", version: "1.0.0" },
        });

        const mcp = (mcpServers ?? []) as unknown[];
        let sessionId: string;

        if (resumeSessionId) {
          await request("session/resume", {
            sessionId: resumeSessionId,
            cwd: ".",
            mcpServers: mcp,
          });
          sessionId = resumeSessionId;
        } else {
          const res = await request<{ sessionId: string }>("session/new", {
            cwd: ".",
            mcpServers: mcp,
          });
          sessionId = res.sessionId;
        }

        sendFireAndForget("session/prompt", {
          sessionId,
          prompt: [{ type: "text", text: task }],
        });

        return { sessionId };
      } finally {
        channel.close();
      }
    },
  };
}
