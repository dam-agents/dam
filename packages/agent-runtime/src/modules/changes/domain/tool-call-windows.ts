export const SETTLED_KEPT_MS = 120_000;
export const OPEN_KEPT_MS = 60 * 60_000;
export const WINDOW_SLACK_MS = 1_500;

export interface ToolCallWindows {
  started(sessionId: string, toolCallId: string): void;
  settled(sessionId: string, toolCallId: string): void;
  sessionsAt(at: number): string[];
}

interface Window {
  sessionId: string;
  start: number;
  end: number | null;
}

export function createToolCallWindows(
  now: () => number = Date.now,
): ToolCallWindows {
  const open = new Map<string, Window>();
  const settled: Window[] = [];
  const keyOf = (sessionId: string, toolCallId: string) =>
    `${sessionId}\n${toolCallId}`;

  function prune(): void {
    const at = now();
    while (settled.length > 0 && at - settled[0]!.end! > SETTLED_KEPT_MS)
      settled.shift();
    for (const [key, window] of open)
      if (at - window.start > OPEN_KEPT_MS) open.delete(key);
  }

  return {
    started(sessionId, toolCallId) {
      prune();
      const key = keyOf(sessionId, toolCallId);
      if (!open.has(key)) open.set(key, { sessionId, start: now(), end: null });
    },
    settled(sessionId, toolCallId) {
      const key = keyOf(sessionId, toolCallId);
      const window = open.get(key);
      if (!window) return;
      open.delete(key);
      settled.push({ ...window, end: now() });
      prune();
    },
    sessionsAt(at) {
      prune();
      const covering = [...open.values(), ...settled].filter(
        (window) =>
          window.start - WINDOW_SLACK_MS <= at &&
          at <= (window.end ?? now()) + WINDOW_SLACK_MS,
      );
      return [...new Set(covering.map((window) => window.sessionId))];
    },
  };
}
