import { join } from "node:path";
import { z } from "zod";
import { openJsonFile } from "../../../core/document-store.js";

const triggerStateSchema = z.object({
  scheduleSessions: z.record(z.string(), z.string()).catch({}).default({}),
  artifactSessions: z.record(z.string(), z.string()).catch({}).default({}),
});

export type TriggerState = z.infer<typeof triggerStateSchema>;

export interface TriggerStateStore {
  getSessionForSchedule(scheduleId: string): string | undefined;
  setSessionForSchedule(scheduleId: string, sessionId: string): void;
  clearSessionForSchedule(scheduleId: string): void;
  getSessionForArtifact(artifactId: string): string | undefined;
  setSessionForArtifact(artifactId: string, sessionId: string): void;
  clearSessionForArtifact(artifactId: string): void;
}

export function createTriggerStateStore(stateDir: string): TriggerStateStore {
  const store = openJsonFile(join(stateDir, "trigger-state.json"), {
    schema: triggerStateSchema,
    initial: () => ({ scheduleSessions: {}, artifactSessions: {} }),
  });

  return {
    getSessionForSchedule(scheduleId) {
      return store.read().scheduleSessions[scheduleId];
    },
    setSessionForSchedule(scheduleId, sessionId) {
      const state = store.read();
      store.write({
        ...state,
        scheduleSessions: {
          ...state.scheduleSessions,
          [scheduleId]: sessionId,
        },
      });
    },
    clearSessionForSchedule(scheduleId) {
      const state = store.read();
      if (!(scheduleId in state.scheduleSessions)) return;
      const next = { ...state.scheduleSessions };
      delete next[scheduleId];
      store.write({ ...state, scheduleSessions: next });
    },
    getSessionForArtifact(artifactId) {
      return store.read().artifactSessions[artifactId];
    },
    setSessionForArtifact(artifactId, sessionId) {
      const state = store.read();
      store.write({
        ...state,
        artifactSessions: {
          ...state.artifactSessions,
          [artifactId]: sessionId,
        },
      });
    },
    clearSessionForArtifact(artifactId) {
      const state = store.read();
      if (!(artifactId in state.artifactSessions)) return;
      const next = { ...state.artifactSessions };
      delete next[artifactId];
      store.write({ ...state, artifactSessions: next });
    },
  };
}
