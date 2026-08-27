import { createInMemoryChannel } from "../infrastructure/in-memory-channel.js";
import type { PlatformSessionMeta } from "../infrastructure/session-metadata-store.js";
import type { AcpRuntime } from "./acp-runtime/acp-runtime.js";

const PROMPT_HANDOFF_GRACE_MS = 60_000;

export interface TriggerSessionDriver {
  start(opts: {
    task: string;
    mcpServers?: unknown[];
    resumeSessionId?: string;
    platformMeta?: PlatformSessionMeta;
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
    async start({ task, mcpServers, resumeSessionId, platformMeta }) {
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

      let closed = false;
      let graceTimer: ReturnType<typeof setTimeout> | undefined;

      function closeChannel(): void {
        if (closed) return;
        closed = true;
        if (graceTimer) clearTimeout(graceTimer);
        channel.close();
      }

      function submitPrompt(sessionId: string): void {
        const id = nextId++;
        pending.set(id, () => closeChannel());
        graceTimer = setTimeout(closeChannel, PROMPT_HANDOFF_GRACE_MS);
        graceTimer.unref?.();
        channel.sendToServer(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            method: "session/prompt",
            params: { sessionId, prompt: [{ type: "text", text: task }] },
          }),
        );
      }

      deps.acpRuntime.attach(channel, { viewer: false });

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
            ...(platformMeta && { _meta: { platform: platformMeta } }),
          });
          sessionId = res.sessionId;
        }

        submitPrompt(sessionId);

        return { sessionId };
      } catch (err) {
        closeChannel();
        throw err;
      }
    },
  };
}
