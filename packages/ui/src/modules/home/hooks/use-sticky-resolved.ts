import { useCallback, useMemo, useState } from "react";

import { type FeedItem, sortFeedItems } from "../lib/feed-item.js";

export interface StickyResolved {
  has: (id: string) => boolean;
  keep: (item: FeedItem) => void;
  drop: (id: string) => void;
  merge: (items: readonly FeedItem[]) => FeedItem[];
}

export function useStickyResolved(): StickyResolved {
  const [kept, setKept] = useState<ReadonlyMap<string, FeedItem>>(
    () => new Map(),
  );

  const keep = useCallback((item: FeedItem) => {
    setKept((prev) => new Map(prev).set(item.id, item));
  }, []);

  const drop = useCallback((id: string) => {
    setKept((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const has = useCallback((id: string) => kept.has(id), [kept]);

  const merge = useCallback(
    (items: readonly FeedItem[]) => {
      if (kept.size === 0) return [...items];
      const live = new Set(items.map((item) => item.id));
      const settled = [...kept.values()].filter((item) => !live.has(item.id));
      return settled.length === 0
        ? [...items]
        : sortFeedItems([...items, ...settled]);
    },
    [kept],
  );

  return useMemo(() => ({ has, keep, drop, merge }), [has, keep, drop, merge]);
}
