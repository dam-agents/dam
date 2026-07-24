import type {
  DriverBinding,
  EventHandler,
  Plugin,
  ScheduleResetEventPayload,
  TriggerEventPayload,
} from "agent-runtime-api";
import { SessionMode, SessionType } from "api-server-api";
import type { TriggerSessionDriver } from "../../acp/index.js";
import type { TriggerStateStore } from "../infrastructure/trigger-state-store.js";

const IMPL_NAME = "trigger";

// Event driver for `trigger` and `schedule-reset`: fire a scheduled session
// (resuming a continuous schedule's prior session, else starting fresh), or
// clear a schedule's continuous binding so the next fire starts fresh.
export function createTriggerPlugin(deps: {
  driver: TriggerSessionDriver;
  stateStore: TriggerStateStore;
}): Plugin {
  const fire = async (payload: TriggerEventPayload): Promise<void> => {
    // A "regular"-typed trigger opens an ordinary chat (no scheduleId on the
    // session meta, so the UI lists it under Chats without a scheduled badge);
    // the payload scheduleId still keys continuous binding and fire dedupe.
    const platformMeta =
      payload.sessionType === "regular"
        ? { type: SessionType.Regular, mode: SessionMode.Chat }
        : {
            type: SessionType.ScheduleCron,
            mode: SessionMode.Chat,
            scheduleId: payload.scheduleId,
          };
    if ((payload.sessionMode ?? "fresh") === "continuous") {
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
      deps.stateStore.setSessionForSchedule(payload.scheduleId, res.sessionId);
      return;
    }
    await deps.driver.start({
      task: payload.task,
      mcpServers: payload.mcpServers,
      platformMeta,
    });
  };

  return {
    name: IMPL_NAME,
    bindEvent(kind: string, _binding: DriverBinding): EventHandler {
      if (kind === "trigger") {
        return async (payload) => fire(payload as TriggerEventPayload);
      }
      if (kind === "schedule-reset") {
        return async (payload) =>
          deps.stateStore.clearSessionForSchedule(
            (payload as ScheduleResetEventPayload).scheduleId,
          );
      }
      throw new Error(
        `plugin "${IMPL_NAME}" does not handle event kind "${kind}"`,
      );
    },
  };
}
