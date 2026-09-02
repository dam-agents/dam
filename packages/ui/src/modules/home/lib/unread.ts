import { SessionMode } from "api-server-api";

import type { SessionView } from "../../../types.js";

export function isUnreadSession(
  session: SessionView,
  options?: { open?: boolean },
): boolean {
  if (options?.open) return false;
  if (session.mode === SessionMode.Terminal) return false;
  if (!session.seenAt || !session.updatedAt) return false;
  return Date.parse(session.updatedAt) > Date.parse(session.seenAt);
}

export const FEED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function isFeedableSession(
  session: SessionView,
  now: number = Date.now(),
): boolean {
  if (session.mode === SessionMode.Terminal) return false;
  const at = session.updatedAt ?? session.createdAt;
  if (!at) return false;
  return now - Date.parse(at) <= FEED_WINDOW_MS;
}

export function isUnreadItem(item: {
  kind: string;
  session?: SessionView;
}): boolean {
  return (
    item.kind === "unread" &&
    item.session !== undefined &&
    isUnreadSession(item.session)
  );
}
