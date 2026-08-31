import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../store.js";
import {
  dismissalKey,
  loadDismissed,
  saveDismissed,
} from "./lib/dismissals.js";
import type { FeedItem } from "./lib/feed-item.js";

export interface DismissalsSlice {
  dismissedKeys: ReadonlySet<string>;
  dismissFeedItems: (items: readonly FeedItem[]) => void;
  dismissByKey: (key: string) => void;
}

export const createDismissalsSlice: StateCreator<
  PlatformStore,
  [],
  [],
  DismissalsSlice
> = (set, get) => ({
  dismissedKeys: new Set(loadDismissed()),
  dismissFeedItems: (items) => {
    const added = items
      .map(dismissalKey)
      .filter((key): key is string => key !== null);
    if (added.length === 0) return;
    const merged = new Set([...get().dismissedKeys, ...added]);
    set({ dismissedKeys: new Set(saveDismissed([...merged])) });
  },
  dismissByKey: (key) => {
    const merged = new Set([...get().dismissedKeys, key]);
    set({ dismissedKeys: new Set(saveDismissed([...merged])) });
  },
});
