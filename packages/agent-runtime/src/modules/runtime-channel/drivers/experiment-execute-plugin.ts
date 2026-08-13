import type {
  DriverBinding,
  EventHandler,
  ExperimentExecuteEventPayload,
  Plugin,
} from "agent-runtime-api";
import { SessionMode, SessionType } from "api-server-api";
import type { TriggerSessionDriver } from "../../acp/index.js";

const IMPL_NAME = "experiment-execute";

export function createExperimentExecutePlugin(deps: {
  driver: TriggerSessionDriver;
}): Plugin {
  return {
    name: IMPL_NAME,
    bindEvent(kind: string, _binding: DriverBinding): EventHandler {
      if (kind !== "experiment-execute") {
        throw new Error(
          `plugin "${IMPL_NAME}" does not handle event kind "${kind}"`,
        );
      }
      return async (payload) => {
        const p = payload as ExperimentExecuteEventPayload;
        await deps.driver.start({
          task: p.task,
          platformMeta: {
            type: SessionType.ExperimentExecute,
            mode: SessionMode.Chat,
            experimentId: p.experimentId,
          },
        });
      };
    },
  };
}
