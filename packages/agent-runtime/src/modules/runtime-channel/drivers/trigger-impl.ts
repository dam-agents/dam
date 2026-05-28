import type { TriggerEventPayload } from "agent-runtime-api";
import type { TriggerSessionDriver } from "../../acp/index.js";
import type { TriggerStateStore } from "../infrastructure/trigger-state-store.js";

export interface TriggerImpl {
  handle(payload: TriggerEventPayload): Promise<void>;
}

export function createTriggerImpl(deps: {
  driver: TriggerSessionDriver;
  stateStore: TriggerStateStore;
}): TriggerImpl {
  return {
    async handle(payload) {
      const mode = payload.sessionMode ?? "fresh";

      if (mode === "continuous") {
        const prior = deps.stateStore.getSessionForSchedule(payload.scheduleId);
        if (prior) {
          await deps.driver.start({
            task: payload.task,
            mcpServers: payload.mcpServers,
            resumeSessionId: prior,
          });
          return;
        }
        const res = await deps.driver.start({
          task: payload.task,
          mcpServers: payload.mcpServers,
        });
        deps.stateStore.setSessionForSchedule(
          payload.scheduleId,
          res.sessionId,
        );
        return;
      }

      await deps.driver.start({
        task: payload.task,
        mcpServers: payload.mcpServers,
      });
    },
  };
}
