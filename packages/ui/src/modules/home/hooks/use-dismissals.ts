import { useCallback } from "react";

import { useStore } from "../../../store.js";
import { dismissalKey, sessionDismissedAt } from "../lib/dismissals.js";
import type { FeedItem } from "../lib/feed-item.js";

export interface Dismissals {
  isDismissed: (item: FeedItem) => boolean;
  dismiss: (items: readonly FeedItem[]) => void;
  dismissedAt: (agentId: string, sessionId: string) => number | null;
}

export function useDismissals(): Dismissals {
  const dismissedKeys = useStore((s) => s.dismissedKeys);
  const dismiss = useStore((s) => s.dismissFeedItems);

  const isDismissed = useCallback(
    (item: FeedItem) => {
      const key = dismissalKey(item);
      return key !== null && dismissedKeys.has(key);
    },
    [dismissedKeys],
  );

  const dismissedAt = useCallback(
    (agentId: string, sessionId: string) =>
      sessionDismissedAt(dismissedKeys, agentId, sessionId),
    [dismissedKeys],
  );

  return { isDismissed, dismiss, dismissedAt };
}
