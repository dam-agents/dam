import type { BackgroundWorkItem } from "agent-runtime-api";

export interface HeldSession {
  sessionId: string;
  items: BackgroundWorkItem[];
}

export interface BackgroundWorkRegistry {
  report(sessionId: string, items: BackgroundWorkItem[]): void;
  hasWork(sessionId: string): boolean;
  held(): HeldSession[];
  reported(): HeldSession[];
  drop(sessionId: string, itemId: string): void;
  keepChanged(): void;
  forget(sessionId: string): void;
  clear(): void;
  onRelease(cb: () => void): void;
  onChange(cb: () => void): void;
}

export interface BackgroundWorkRegistryDeps {
  enabled?: boolean;
  isKept?: (sessionId: string, item: BackgroundWorkItem) => boolean;
  log?: (msg: string) => void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Holds the Harness Tasks each session reported,
 * for two separate jobs. Every reported item holds its session open, because
 * the harness kills a closed session's tasks. Only items that are kept make
 * the runtime busy, so the user can stop a task from keeping the agent awake
 * without killing it. A task the user stopped is dropped and ignored in later
 * reports until a report leaves it out, so a stale report cannot bring it back.
 */
export function createBackgroundWorkRegistry(
  deps: BackgroundWorkRegistryDeps = {},
): BackgroundWorkRegistry {
  const enabled = deps.enabled ?? true;
  const isKept = deps.isKept ?? (() => true);

  const holds = new Map<string, BackgroundWorkItem[]>();
  const dropped = new Map<string, Set<string>>();

  const releaseListeners: (() => void)[] = [];
  const changeListeners: (() => void)[] = [];
  function notifyChange(): void {
    for (const cb of changeListeners) cb();
  }
  function notifyRelease(): void {
    notifyChange();
    for (const cb of releaseListeners) cb();
  }

  function sameItems(
    a: BackgroundWorkItem[],
    b: BackgroundWorkItem[],
  ): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function describe(items: BackgroundWorkItem[]): string {
    return items
      .map((i) => i.description ?? i.command ?? i.id)
      .join(", ")
      .slice(0, 300);
  }

  function withoutDropped(
    sessionId: string,
    items: BackgroundWorkItem[],
  ): BackgroundWorkItem[] {
    const ignored = dropped.get(sessionId);
    if (!ignored) return items;
    const reportedIds = new Set(items.map((i) => i.id));
    for (const id of ignored) if (!reportedIds.has(id)) ignored.delete(id);
    if (ignored.size === 0) dropped.delete(sessionId);
    return items.filter((i) => !ignored.has(i.id));
  }

  function keptSessions(): HeldSession[] {
    const out: HeldSession[] = [];
    for (const [sessionId, items] of holds) {
      const kept = items.filter((item) => isKept(sessionId, item));
      if (kept.length > 0) out.push({ sessionId, items: kept });
    }
    return out;
  }

  function release(sessionId: string, reason: string): void {
    holds.delete(sessionId);
    deps.log?.(`background work in session ${sessionId} is ${reason}`);
    notifyRelease();
  }

  return {
    report(sessionId, reportedItems) {
      const held = holds.has(sessionId);
      const items = withoutDropped(sessionId, reportedItems);
      if (!items.length) {
        if (held) release(sessionId, "done");
        return;
      }
      if (!enabled) return;
      const previous = holds.get(sessionId);
      holds.set(sessionId, items);
      if (!held) {
        deps.log?.(
          `holding session ${sessionId} for background work: ${describe(items)}`,
        );
      }
      if (previous === undefined || !sameItems(previous, items)) notifyChange();
    },

    hasWork(sessionId) {
      return holds.has(sessionId);
    },

    held() {
      return keptSessions();
    },

    reported() {
      return [...holds.entries()].map(([sessionId, items]) => ({
        sessionId,
        items,
      }));
    },

    drop(sessionId, itemId) {
      const ignored = dropped.get(sessionId) ?? new Set<string>();
      ignored.add(itemId);
      dropped.set(sessionId, ignored);
      const items = holds.get(sessionId);
      if (!items?.some((i) => i.id === itemId)) return;
      const rest = items.filter((i) => i.id !== itemId);
      if (rest.length === 0) {
        release(sessionId, "stopped");
        return;
      }
      holds.set(sessionId, rest);
      notifyRelease();
    },

    keepChanged() {
      notifyRelease();
    },

    forget(sessionId) {
      dropped.delete(sessionId);
      if (holds.delete(sessionId)) notifyRelease();
    },

    clear() {
      dropped.clear();
      if (holds.size === 0) return;
      holds.clear();
      notifyRelease();
    },

    onRelease(cb) {
      releaseListeners.push(cb);
    },

    onChange(cb) {
      changeListeners.push(cb);
    },
  };
}
