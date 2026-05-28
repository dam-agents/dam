import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface TriggerState {
  scheduleSessions: Record<string, string>;
}

const INITIAL: TriggerState = { scheduleSessions: {} };

export interface TriggerStateStore {
  getSessionForSchedule(scheduleId: string): string | undefined;
  setSessionForSchedule(scheduleId: string, sessionId: string): void;
  clearSessionForSchedule(scheduleId: string): void;
}

function loadFromDisk(path: string): TriggerState {
  if (!existsSync(path)) return { ...INITIAL };
  try {
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!raw || typeof raw !== "object") return { ...INITIAL };
    const obj = raw as Record<string, unknown>;
    const sessionsObj =
      obj.scheduleSessions && typeof obj.scheduleSessions === "object"
        ? (obj.scheduleSessions as Record<string, unknown>)
        : {};
    const scheduleSessions: Record<string, string> = {};
    for (const [k, v] of Object.entries(sessionsObj)) {
      if (typeof v === "string") scheduleSessions[k] = v;
    }
    return { scheduleSessions };
  } catch {
    return { ...INITIAL };
  }
}

export function createTriggerStateStore(path: string): TriggerStateStore {
  let cache: TriggerState | null = null;

  function read(): TriggerState {
    if (cache) return cache;
    cache = loadFromDisk(path);
    return cache;
  }

  function write(state: TriggerState): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(state, null, 2));
    cache = state;
  }

  return {
    getSessionForSchedule(scheduleId) {
      return read().scheduleSessions[scheduleId];
    },
    setSessionForSchedule(scheduleId, sessionId) {
      const state = read();
      write({
        scheduleSessions: {
          ...state.scheduleSessions,
          [scheduleId]: sessionId,
        },
      });
    },
    clearSessionForSchedule(scheduleId) {
      const state = read();
      if (!(scheduleId in state.scheduleSessions)) return;
      const next = { ...state.scheduleSessions };
      delete next[scheduleId];
      write({ scheduleSessions: next });
    },
  };
}
