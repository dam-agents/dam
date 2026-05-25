import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Persists the runtime channel's `lastAppliedVersion` + `lastAppliedHash` on
 * the agent PVC. Read once at boot, written after every successful apply.
 *
 * The file is the agent's view of the monotonic cursor (ADR-052). The
 * version is the single ack marker for the apply payload; the hash is the
 * short-circuit for no-op state pushes.
 *
 * Lives under `$HOME/.platform/runtime-state.json` — kept off the agent's
 * working tree so user file ops don't see it.
 */
export interface RuntimeState {
  lastAppliedVersion: number;
  lastAppliedHash: string | null;
}

const INITIAL: RuntimeState = { lastAppliedVersion: 0, lastAppliedHash: null };

export interface StateStore {
  read(): RuntimeState;
  write(state: RuntimeState): void;
}

export function createStateStore(path: string): StateStore {
  let cache: RuntimeState | null = null;
  return {
    read(): RuntimeState {
      if (cache) return cache;
      if (!existsSync(path)) {
        cache = INITIAL;
        return cache;
      }
      try {
        const raw = JSON.parse(readFileSync(path, "utf8"));
        if (
          raw &&
          typeof raw === "object" &&
          typeof raw.lastAppliedVersion === "number"
        ) {
          cache = {
            lastAppliedVersion: raw.lastAppliedVersion,
            lastAppliedHash:
              typeof raw.lastAppliedHash === "string"
                ? raw.lastAppliedHash
                : null,
          };
          return cache;
        }
      } catch {
        // Fall through to initial — a corrupt state file just means the
        // server will redeliver, drivers reconcile idempotently.
      }
      cache = INITIAL;
      return cache;
    },
    write(state: RuntimeState): void {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(state, null, 2));
      cache = state;
    },
  };
}
