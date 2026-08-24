import { useCallback } from "react";

import { useStore } from "../../../store.js";
import { dismissalKey } from "../lib/dismissals.js";
import type { FeedItem } from "../lib/feed-item.js";

export interface Dismissals {
  isDismissed: (item: FeedItem) => boolean;
  dismiss: (items: readonly FeedItem[]) => void;
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

  return { isDismissed, dismiss };
}
