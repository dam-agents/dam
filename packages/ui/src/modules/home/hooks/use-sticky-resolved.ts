import { useCallback, useMemo, useState } from "react";

import { type FeedItem, sortFeedItems } from "../lib/feed-item.js";

export interface StickyResolved {
  labelFor: (id: string) => string | null;
  keep: (item: FeedItem, label: string) => void;
  drop: (id: string) => void;
  merge: (items: readonly FeedItem[]) => FeedItem[];
}

interface Settled {
  item: FeedItem;
  label: string;
}

export function useStickyResolved(): StickyResolved {
  const [kept, setKept] = useState<ReadonlyMap<string, Settled>>(
    () => new Map(),
  );

  const keep = useCallback((item: FeedItem, label: string) => {
    setKept((prev) => new Map(prev).set(item.id, { item, label }));
  }, []);

  const drop = useCallback((id: string) => {
    setKept((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const labelFor = useCallback(
    (id: string) => kept.get(id)?.label ?? null,
    [kept],
  );

  const merge = useCallback(
    (items: readonly FeedItem[]) => {
      if (kept.size === 0) return [...items];
      const live = new Set(items.map((item) => item.id));
      const settled = [...kept.values()]
        .map((entry) => entry.item)
        .filter((item) => !live.has(item.id));
      return settled.length === 0
        ? [...items]
        : sortFeedItems([...items, ...settled]);
    },
    [kept],
  );

  return useMemo(
    () => ({ labelFor, keep, drop, merge }),
    [labelFor, keep, drop, merge],
  );
}
