import type { DismissedEntry } from "api-server-api";

import type { FeedItem } from "./feed-item.js";

export interface DismissalTarget {
  kind: DismissedEntry["kind"];
  id: string;
}

export function dismissalTarget(item: FeedItem): DismissalTarget | null {
  switch (item.kind) {
    case "approval":
      return { kind: "approval", id: item.approval.id };
    case "unread":
      return {
        kind: "session",
        id: `${item.agentId}:${item.session.sessionId}`,
      };
    case "in-progress":
      return null;
  }
}

export function dismissalsByKey(
  entries: readonly DismissedEntry[],
): ReadonlyMap<string, number> {
  const byKey = new Map<string, number>();
  for (const entry of entries) {
    const at = Date.parse(entry.at);
    if (Number.isNaN(at)) continue;
    byKey.set(`${entry.kind}:${entry.id}`, at);
  }
  return byKey;
}

export function isDismissedItem(
  item: FeedItem,
  byKey: ReadonlyMap<string, number>,
): boolean {
  const target = dismissalTarget(item);
  if (!target) return false;
  const at = byKey.get(`${target.kind}:${target.id}`);
  if (at === undefined) return false;
  if (item.kind === "approval") return true;
  const activity = item.at === null ? null : Date.parse(item.at);
  return activity === null || Number.isNaN(activity) || activity <= at;
}

export function sessionDismissedAt(
  byKey: ReadonlyMap<string, number>,
  agentId: string,
  sessionId: string,
): number | null {
  return byKey.get(`session:${agentId}:${sessionId}`) ?? null;
}
