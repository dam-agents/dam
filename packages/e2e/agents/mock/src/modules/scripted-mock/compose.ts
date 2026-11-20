import { appRouter, type ScriptedMockService } from "mock-agent-api";
import { createInitialState } from "./domain/state.js";
import { createScriptedMockService } from "./services/control-service.js";
import { startAcpService } from "./services/acp-service.js";
import { createTrpcDispatch } from "./services/trpc-dispatch.js";
import type { AcpChannel, ToolCall } from "./services/ports.js";
import { createHarnessSpawn } from "./infrastructure/harness-spawn.js";
import { createProcessRunner } from "./infrastructure/process-runner.js";
import { createProxyFetch } from "./infrastructure/proxy-fetch.js";
import { createPlatformToolCaller } from "./infrastructure/platform-tools.js";
import { createSlackReplyPoster } from "./infrastructure/slack-reply.js";
import { createStdioChannel } from "./infrastructure/stdio-channel.js";
import { createWorkspaceWriter } from "./infrastructure/workspace-writer.js";

function toolCallFromEnv(): ToolCall | null {
  const raw = process.env.MOCK_TOOL_CALL;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ToolCall>;
    if (typeof parsed.name !== "string" || parsed.name === "")
      throw new Error("no tool name");
    return { name: parsed.name, arguments: parsed.arguments ?? {} };
  } catch (err) {
    process.stderr.write(
      `[mock-agent] MOCK_TOOL_CALL is not a tool call: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return null;
  }
}

export function composeScriptedMock(): { scriptedMock: ScriptedMockService } {
  const state = createInitialState();
  const proxyFetch = createProxyFetch();
  const scriptedMock = createScriptedMockService({
    state,
    proxyFetch,
    harnessSpawn: createHarnessSpawn(),
  });
  const stdio = createStdioChannel();

  const tryTrpc = createTrpcDispatch({
    channel: stdio,
    router: appRouter,
    ctx: { scriptedMock },
  });

  const acpChannel: AcpChannel = {
    send: (frame) => stdio.send(frame),
    onLine(handler) {
      stdio.onLine((line) => {
        void (async () => {
          if (await tryTrpc(line)) return;
          handler(line);
        })();
      });
    },
  };

  const callTool = createPlatformToolCaller();
  startAcpService({
    channel: acpChannel,
    state,
    workspace: createWorkspaceWriter(process.cwd()),
    proxyFetch,
    processRunner: createProcessRunner(process.cwd()),
    slackReply: createSlackReplyPoster(callTool),
    callTool,
    toolCall: toolCallFromEnv(),
  });

  return { scriptedMock };
}
