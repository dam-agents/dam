import type {
  DriverBinding,
  EventHandler,
  InitializationEventPayload,
  Plugin,
} from "agent-runtime-api";
import { initializationEventPayload } from "agent-runtime-api";
import { SessionMode, SessionType } from "api-server-api";

import type { TriggerSessionDriver } from "../../acp/index.js";

const IMPL_NAME = "initialization";

export function createInitializationPlugin(deps: {
  driver: TriggerSessionDriver;
}): Plugin {
  return {
    name: IMPL_NAME,
    bindEvent(kind: string, _binding: DriverBinding): EventHandler {
      if (kind !== "initialization") {
        throw new Error(
          `plugin "${IMPL_NAME}" does not handle event kind "${kind}"`,
        );
      }
      return async (payload) => {
        const p = initializationEventPayload.parse(payload);
        await deps.driver.start({
          task: p.task,
          platformMeta: {
            type: SessionType.Regular,
            mode: SessionMode.Chat,
            initialization: true,
          },
        });
      };
    },
  };
}
