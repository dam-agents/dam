import type { TriggerEventPayload } from "agent-runtime-api";
import { SessionMode, SessionType } from "api-server-api";
import type { TriggerSessionDriver } from "../../acp/index.js";
import type { TriggerStateStore } from "../infrastructure/trigger-state-store.js";

export interface TriggerImpl {
  handle(payload: TriggerEventPayload): Promise<void>;
  /** Clear a schedule's continuous-session binding so the next fire starts
   *  fresh. */
  reset(scheduleId: string): void;
}

export function createTriggerImpl(deps: {
  driver: TriggerSessionDriver;
  stateStore: TriggerStateStore;
}): TriggerImpl {
  return {
    async handle(payload) {
      const mode = payload.sessionMode ?? "fresh";
      const platformMeta = {
        type: SessionType.ScheduleCron,
        mode: SessionMode.Chat,
        scheduleId: payload.scheduleId,
      };

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
          platformMeta,
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
        platformMeta,
      });
    },

    reset(scheduleId) {
      deps.stateStore.clearSessionForSchedule(scheduleId);
    },
  };
}
