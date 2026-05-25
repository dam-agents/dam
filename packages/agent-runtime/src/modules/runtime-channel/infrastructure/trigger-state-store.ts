import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Continuous-mode binding state (ADR-052): one `scheduleId → sessionId`
 * entry per schedule the agent has run. The trigger handler reads this
 * to decide whether to resume a prior session or create a fresh one.
 *
 * Idempotency on event redelivery is handled by the runtime-channel
 * cursor (`runtime-state.json#lastAppliedVersion`), not here — see
 * `event-loop.ts`. This file is solely the continuous-mode binding.
 *
 * Lives under `$HOME/.platform/trigger-state.json`.
 */
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
    // Corrupt file → start fresh. Continuous-mode bindings reset
    // gracefully (next tick creates a new session).
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
