import type {
  DriverBinding,
  EventHandler,
  ExperimentTriggerEventPayload,
  Plugin,
} from "agent-runtime-api";
import { SessionMode, SessionType } from "api-server-api";
import type { TriggerSessionDriver } from "../../acp/index.js";

const IMPL_NAME = "experiment-trigger";

// Event driver for `experiment-trigger`: start a fresh session for an experiment
// trial, stamped with the experiment's platform metadata.
export function createExperimentTriggerPlugin(deps: {
  driver: TriggerSessionDriver;
}): Plugin {
  return {
    name: IMPL_NAME,
    bindEvent(kind: string, _binding: DriverBinding): EventHandler {
      if (kind !== "experiment-trigger") {
        throw new Error(
          `plugin "${IMPL_NAME}" does not handle event kind "${kind}"`,
        );
      }
      return async (payload) => {
        const p = payload as ExperimentTriggerEventPayload;
        await deps.driver.start({
          task: p.task,
          platformMeta: {
            type: SessionType.ExperimentTrial,
            mode: SessionMode.Chat,
            experimentId: p.experimentId,
          },
        });
      };
    },
  };
}
