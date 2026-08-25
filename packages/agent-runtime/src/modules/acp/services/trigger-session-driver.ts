import { createInProcessCaller } from "../infrastructure/in-process-request.js";
import type { PlatformSessionMeta } from "../infrastructure/session-metadata-store.js";
import type { AcpRuntime } from "./acp-runtime/acp-runtime.js";

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

        caller.notify("session/prompt", {
          sessionId,
          prompt: [{ type: "text", text: task }],
        });

        return { sessionId };
      } finally {
        caller.close();
      }
    },
  };
}
