import { z } from "zod";
import type { DocumentStoreBackend } from "../../../core/document-store.js";

const triggerStateSchema = z.object({
  scheduleSessions: z.record(z.string(), z.string()).catch({}).default({}),
});

export type TriggerState = z.infer<typeof triggerStateSchema>;

export interface TriggerStateStore {
  getSessionForSchedule(scheduleId: string): string | undefined;
  setSessionForSchedule(scheduleId: string, sessionId: string): void;
  clearSessionForSchedule(scheduleId: string): void;
}

export function createTriggerStateStore(
  backend: DocumentStoreBackend,
): TriggerStateStore {
  const store = backend.open("trigger-state", {
    schema: triggerStateSchema,
    initial: () => ({ scheduleSessions: {} }),
  });

  return {
    getSessionForSchedule(scheduleId) {
      return store.read().scheduleSessions[scheduleId];
    },
    setSessionForSchedule(scheduleId, sessionId) {
      store.write({
        scheduleSessions: {
          ...store.read().scheduleSessions,
          [scheduleId]: sessionId,
        },
      });
    },
    clearSessionForSchedule(scheduleId) {
      const { scheduleSessions } = store.read();
      if (!(scheduleId in scheduleSessions)) return;
      const next = { ...scheduleSessions };
      delete next[scheduleId];
      store.write({ scheduleSessions: next });
    },
  };
}
