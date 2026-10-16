export const SIDEBAR_PREVIEW_SESSIONS = 3;

export type SessionListToggle = "more" | "less" | null;

export function sidebarSessionWindow<T>(
  sessions: readonly T[],
  expanded: boolean,
  isActive: (session: T) => boolean,
): T[] {
  if (expanded) return [...sessions];
  const head = sessions.slice(0, SIDEBAR_PREVIEW_SESSIONS);
  if (head.some(isActive)) return head;
  const active = sessions.find(isActive);
  return active ? [...head, active] : head;
}

export function sessionListToggle({
  total,
  expanded,
  hasNextPage,
}: {
  total: number;
  expanded: boolean;
  hasNextPage: boolean;
}): SessionListToggle {
  if (total <= SIDEBAR_PREVIEW_SESSIONS && !hasNextPage) return null;
  return expanded ? "less" : "more";
}
