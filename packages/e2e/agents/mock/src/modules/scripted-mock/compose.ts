import { appRouter, type ScriptedMockService } from "mock-agent-api";
import { createInitialState } from "./domain/state.js";
import { createScriptedMockService } from "./services/control-service.js";
import { startAcpService } from "./services/acp-service.js";
import { createTrpcDispatch } from "./services/trpc-dispatch.js";
import type { AcpChannel } from "./services/ports.js";
import { createStdioChannel } from "./infrastructure/stdio-channel.js";

export interface ScriptedMockComposition {
  scriptedMock: ScriptedMockService;
}

export function composeScriptedMock(): ScriptedMockComposition {
  const state = createInitialState();
  const scriptedMock = createScriptedMockService(state);
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

  startAcpService({ channel: acpChannel, state });

  return { scriptedMock };
}
