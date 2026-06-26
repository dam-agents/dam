import type { ExperimentTriggerEventPayload } from "agent-runtime-api";
import { SessionMode, SessionType } from "api-server-api";
import type { TriggerSessionDriver } from "../../acp/index.js";

export interface ExperimentTriggerImpl {
  handle(payload: ExperimentTriggerEventPayload): Promise<void>;
}

export function createExperimentTriggerImpl(deps: {
  driver: TriggerSessionDriver;
}): ExperimentTriggerImpl {
  return {
    async handle(payload) {
      await deps.driver.start({
        task: payload.task,
        platformMeta: {
          type: SessionType.ExperimentTrial,
          mode: SessionMode.Chat,
          experimentId: payload.experimentId,
        },
      });
    },
  };
}
