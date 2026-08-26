import { createInProcessCaller } from "../infrastructure/in-process-request.js";
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

export function createTriggerSessionDriver(deps: {
  acpRuntime: AcpRuntime;
}): TriggerSessionDriver {
  return {
    async start({ task, mcpServers, resumeSessionId, platformMeta }) {
      const caller = createInProcessCaller((channel) =>
        deps.acpRuntime.attach(channel, { viewer: false }),
      );

      let closed = false;
      let graceTimer: ReturnType<typeof setTimeout> | undefined;

      function closeChannel(): void {
        if (closed) return;
        closed = true;
        if (graceTimer) clearTimeout(graceTimer);
        caller.close();
      }

      function submitPrompt(sessionId: string): void {
        graceTimer = setTimeout(closeChannel, PROMPT_HANDOFF_GRACE_MS);
        graceTimer.unref?.();
        void caller.request("session/prompt", {
          sessionId,
          prompt: [{ type: "text", text: task }],
        }).then(closeChannel, closeChannel);
      }

      try {
        await caller.request("initialize", {
          protocolVersion: 1,
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: true },
          },
          clientInfo: { name: "platform-trigger", version: "1.0.0" },
        });

        const mcp = (mcpServers ?? []) as unknown[];
        let sessionId: string;

        if (resumeSessionId) {
          await caller.request("session/resume", {
            sessionId: resumeSessionId,
            cwd: ".",
            mcpServers: mcp,
          });
          sessionId = resumeSessionId;
        } else {
          const res = await caller.request<{ sessionId: string }>(
            "session/new",
            {
              cwd: ".",
              mcpServers: mcp,
              ...(platformMeta && { _meta: { platform: platformMeta } }),
            },
          );
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
