import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../store.js";

export interface BrowserOpenRequest {
  url: string;
  id: number;
}

export interface BrowserSlice {
  browserOpenRequest: BrowserOpenRequest | null;
  setOpenBrowser: (agentId: string | null, url?: string) => void;
  takeBrowserOpenRequest: () => BrowserOpenRequest | null;
}

export const createBrowserSlice: StateCreator<
  PlatformStore,
  [],
  [],
  BrowserSlice
> = (set, get) => ({
  browserOpenRequest: null,
  setOpenBrowser: (agentId, url) => {
    if (!agentId) return get().setDock(null);
    get().setDock({ kind: "browser", agentId });
    if (url)
      set((state) => ({
        browserOpenRequest: {
          url,
          id: (state.browserOpenRequest?.id ?? 0) + 1,
        },
      }));
  },
  takeBrowserOpenRequest: () => {
    const request = get().browserOpenRequest;
    if (request) set({ browserOpenRequest: null });
    return request;
  },
});
