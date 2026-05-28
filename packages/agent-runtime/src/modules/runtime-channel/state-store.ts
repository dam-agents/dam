import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

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
      } catch {}
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
