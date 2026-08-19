import { useCallback, useMemo, useState } from "react";

import {
  dismissalKey,
  loadDismissed,
  saveDismissed,
} from "../lib/dismissals.js";
import type { FeedItem } from "../lib/feed-item.js";

export interface Dismissals {
  isDismissed: (item: FeedItem) => boolean;
  dismiss: (items: readonly FeedItem[]) => void;
}

export function useDismissals(): Dismissals {
  const [keys, setKeys] = useState<readonly string[]>(() => loadDismissed());
  const dismissed = useMemo(() => new Set(keys), [keys]);

  const isDismissed = useCallback(
    (item: FeedItem) => {
      const key = dismissalKey(item);
      return key !== null && dismissed.has(key);
    },
    [dismissed],
  );

  const dismiss = useCallback((items: readonly FeedItem[]) => {
    const added = items
      .map(dismissalKey)
      .filter((key): key is string => key !== null);
    if (added.length === 0) return;
    setKeys((prev) => saveDismissed([...new Set([...prev, ...added])]));
  }, []);

  return { isDismissed, dismiss };
}
