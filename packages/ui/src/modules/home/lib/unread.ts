import type { AttentionItem } from "api-server-api";

import type { SessionView } from "../../../types.js";

function laterThanSeen(
  activityAt: string | null | undefined,
  seenAt: string | null | undefined,
): boolean {
  if (!activityAt) return false;
  if (!seenAt) return true;
  return Date.parse(activityAt) > Date.parse(seenAt);
}

export function isUnreadSession(
  session: SessionView,
  options?: { open?: boolean },
): boolean {
  if (options?.open) return false;
  return laterThanSeen(session.updatedAt, session.seenAt);
}

const FEED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function isFeedableAttention(
  item: AttentionItem,
  now: number = Date.now(),
): boolean {
  const at = item.activityAt ?? item.createdAt;
  return now - Date.parse(at) <= FEED_WINDOW_MS;
}

export function isUnreadItem(item: {
  kind: string;
  session?: AttentionItem;
}): boolean {
  return (
    item.kind === "unread" &&
    item.session !== undefined &&
    laterThanSeen(item.session.activityAt, item.session.seenAt)
  );
}
