import { createInMemoryChannel } from "../infrastructure/in-memory-channel.js";
import type { AcpRuntime } from "./acp-runtime.js";

/**
 * Port for in-process trigger dispatch (ADR-052). Other modules in this
 * package (notably `runtime-channel/drivers/trigger-impl`) depend on this
 * abstraction — not on `AcpRuntime` directly — so the module boundary
 * stays loose.
 *
 * `start` provisions a session (new or resumed) and queues a prompt on it.
 * It does NOT wait for the prompt to complete — the agent process keeps
 * processing after the call returns, and the runtime's prompt slot is
 * preserved so the response lands cleanly with no listener.
 */
export interface TriggerSessionDriver {
  start(opts: {
    task: string;
    mcpServers?: unknown[];
    /** Resume this session (continuous mode). When omitted a fresh
     *  session is created and its id returned. */
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
        // Allocate an id so the agent treats it as a request (prompts
        // are request-shaped in ACP), but never read the response —
        // we close the channel right after.
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
          // `session/resume` is mediated entirely by the runtime —
          // serves from log metadata when hot, cold-bootstraps via
          // session/load against the agent process otherwise.
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
