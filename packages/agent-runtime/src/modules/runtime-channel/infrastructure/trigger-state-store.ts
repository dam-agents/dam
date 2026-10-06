import { join } from "node:path";
import { z } from "zod";
import { openJsonFile } from "../../../core/document-store.js";

const triggerStateSchema = z.object({
  scheduleSessions: z.record(z.string(), z.string()).catch({}).default({}),
  modelsBeforeSwitch: z.record(z.string(), z.string()).catch({}).default({}),
});

type TriggerState = z.infer<typeof triggerStateSchema>;

export interface TriggerStateStore {
  getSessionForSchedule(scheduleId: string): string | undefined;
  setSessionForSchedule(scheduleId: string, sessionId: string): void;
  clearSessionForSchedule(scheduleId: string): void;
  getModelBeforeSwitch(scheduleId: string): string | undefined;
  setModelBeforeSwitch(scheduleId: string, model: string): void;
  clearModelBeforeSwitch(scheduleId: string): void;
}

function without(
  record: Record<string, string>,
  key: string,
): Record<string, string> {
  const next = { ...record };
  delete next[key];
  return next;
}

export function createTriggerStateStore(stateDir: string): TriggerStateStore {
  const store = openJsonFile(join(stateDir, "trigger-state.json"), {
    schema: triggerStateSchema,
    initial: () => ({ scheduleSessions: {}, modelsBeforeSwitch: {} }),
  });
  const update = (patch: Partial<TriggerState>) =>
    store.write({ ...store.read(), ...patch });

  return {
    getSessionForSchedule(scheduleId) {
      return store.read().scheduleSessions[scheduleId];
    },
    setSessionForSchedule(scheduleId, sessionId) {
      update({
        scheduleSessions: {
          ...store.read().scheduleSessions,
          [scheduleId]: sessionId,
        },
      });
    },
    clearSessionForSchedule(scheduleId) {
      const { scheduleSessions, modelsBeforeSwitch } = store.read();
      if (
        !(scheduleId in scheduleSessions) &&
        !(scheduleId in modelsBeforeSwitch)
      )
        return;
      update({
        scheduleSessions: without(scheduleSessions, scheduleId),
        modelsBeforeSwitch: without(modelsBeforeSwitch, scheduleId),
      });
    },
    getModelBeforeSwitch(scheduleId) {
      return store.read().modelsBeforeSwitch[scheduleId];
    },
    setModelBeforeSwitch(scheduleId, model) {
      update({
        modelsBeforeSwitch: {
          ...store.read().modelsBeforeSwitch,
          [scheduleId]: model,
        },
      });
    },
    clearModelBeforeSwitch(scheduleId) {
      const { modelsBeforeSwitch } = store.read();
      if (!(scheduleId in modelsBeforeSwitch)) return;
      update({ modelsBeforeSwitch: without(modelsBeforeSwitch, scheduleId) });
    },
  };
}
