import type {
  DriverBinding,
  EventHandler,
  ExperimentExecuteEventPayload,
  Plugin,
} from "agent-runtime-api";
import { SessionMode, SessionType } from "api-server-api";
import type { TriggerSessionDriver } from "../../acp/index.js";

const IMPL_NAME = "experiment-execute";

// Event driver for `experiment-execute` (#2942): the user pressed Execute on
// a draft Experiment. Opens a fresh session and hands the harness the launch
// prompt; the harness backgrounds the script, which reports to the platform
// itself — this turn only starts the process.
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
