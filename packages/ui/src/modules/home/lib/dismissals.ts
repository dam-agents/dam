import type { FeedItem } from "./feed-item.js";

const STORAGE_KEY = "platform-home-dismissed";
const MAX_KEYS = 300;

export function dismissalKey(item: FeedItem): string | null {
  switch (item.kind) {
    case "approval":
      return `approval:${item.approval.id}:${item.approval.createdAt}`;
    case "unread":
      return `session:${item.agentId}:${item.session.sessionId}:${item.at ?? ""}`;
    case "in-progress":
      return null;
  }
}

export function sessionDismissedAt(
  keys: Iterable<string>,
  agentId: string,
  sessionId: string,
): number | null {
  const prefix = `session:${agentId}:${sessionId}:`;
  let newest: number | null = null;
  for (const key of keys) {
    if (!key.startsWith(prefix)) continue;
    const at = Date.parse(key.slice(prefix.length));
    if (Number.isNaN(at)) continue;
    if (newest === null || at > newest) newest = at;
  }
  return newest;
}

export function loadDismissed(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

export function saveDismissed(keys: readonly string[]): string[] {
  const capped = keys.slice(-MAX_KEYS);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(capped));
  } catch {}
  return capped;
}
