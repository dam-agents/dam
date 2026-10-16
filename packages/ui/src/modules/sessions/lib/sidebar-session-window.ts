export const SIDEBAR_PREVIEW_SESSIONS = 3;

export type SessionListToggle = "more" | "less" | null;

function headSize(pinned: number): number {
  return Math.max(SIDEBAR_PREVIEW_SESSIONS, pinned);
}

export function sidebarSessionWindow<T>(
  sessions: readonly T[],
  expanded: boolean,
  isActive: (session: T) => boolean,
  pinned = 0,
): T[] {
  if (expanded) return [...sessions];
  const head = sessions.slice(0, headSize(pinned));
  if (head.some(isActive)) return head;
  const active = sessions.find(isActive);
  return active ? [...head, active] : head;
}

export function sessionListToggle({
  total,
  expanded,
  hasNextPage,
  pinned = 0,
}: {
  total: number;
  expanded: boolean;
  hasNextPage: boolean;
  pinned?: number;
}): SessionListToggle {
  if (total <= headSize(pinned) && !hasNextPage) return null;
  return expanded ? "less" : "more";
}
