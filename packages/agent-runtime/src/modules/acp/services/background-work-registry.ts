import type { BackgroundWorkItem } from "agent-runtime-api";

export interface HeldSession {
  sessionId: string;
  items: BackgroundWorkItem[];
}

export interface BackgroundWorkRegistry {
  report(sessionId: string, items: BackgroundWorkItem[]): void;
  hasWork(sessionId: string): boolean;
  held(): HeldSession[];
  forget(sessionId: string): void;
  clear(): void;
  onRelease(cb: () => void): void;
}

export interface BackgroundWorkRegistryDeps {
  enabled?: boolean;
  log?: (msg: string) => void;
}

export function createBackgroundWorkRegistry(
  deps: BackgroundWorkRegistryDeps = {},
): BackgroundWorkRegistry {
  const enabled = deps.enabled ?? true;

  const holds = new Map<string, BackgroundWorkItem[]>();

  const releaseListeners: (() => void)[] = [];
  function notifyRelease(): void {
    for (const cb of releaseListeners) cb();
  }

  function describe(items: BackgroundWorkItem[]): string {
    return items
      .map((i) => i.description ?? i.command ?? i.id)
      .join(", ")
      .slice(0, 300);
  }

  return {
    report(sessionId, items) {
      const held = holds.has(sessionId);
      if (!items.length) {
        if (held) {
          holds.delete(sessionId);
          deps.log?.(`background work in session ${sessionId} is done`);
          notifyRelease();
        }
        return;
      }
      if (!enabled) return;
      holds.set(sessionId, items);
      if (!held) {
        deps.log?.(
          `holding session ${sessionId} for background work: ${describe(items)}`,
        );
      }
    },

    hasWork(sessionId) {
      return holds.has(sessionId);
    },

    held() {
      return [...holds.entries()].map(([sessionId, items]) => ({
        sessionId,
        items,
      }));
    },

    forget(sessionId) {
      if (holds.delete(sessionId)) notifyRelease();
    },

    clear() {
      if (holds.size === 0) return;
      holds.clear();
      notifyRelease();
    },

    onRelease(cb) {
      releaseListeners.push(cb);
    },
  };
}
