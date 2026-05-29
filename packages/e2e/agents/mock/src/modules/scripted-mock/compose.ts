import type { ScriptedMockService } from "mock-agent-api";
import { createInitialState } from "./domain/state.js";
import { createScriptedMockService } from "./services/control-service.js";
import { startAcpService } from "./services/acp-service.js";
import { createStdioChannel } from "./infrastructure/stdio-channel.js";
import { createControlServer } from "./infrastructure/control-server.js";

export interface ScriptedMockComposition {
  scriptedMock: ScriptedMockService;
  start(opts: { controlPort: number; controlHost: string }): Promise<void>;
}

export function composeScriptedMock(): ScriptedMockComposition {
  const state = createInitialState();
  const scriptedMock = createScriptedMockService(state);
  const channel = createStdioChannel();
  const controlServer = createControlServer(scriptedMock);

  startAcpService({ channel, state });

  return {
    scriptedMock,
    async start({ controlPort, controlHost }) {
      await controlServer.listen(controlPort, controlHost);
    },
  };
}
