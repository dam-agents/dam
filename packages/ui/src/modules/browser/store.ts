import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../store.js";

export interface BrowserOpenRequest {
  url: string;
  id: number;
}

export interface BrowserSlice {
  openBrowserAgentId: string | null;
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
  openBrowserAgentId: null,
  browserOpenRequest: null,
  setOpenBrowser: (agentId, url) =>
    set((state) =>
      agentId
        ? {
            openBrowserAgentId: agentId,
            browserOpenRequest: url
              ? { url, id: (state.browserOpenRequest?.id ?? 0) + 1 }
              : state.browserOpenRequest,
            openFilePath: null,
            openFileDirty: false,
            openArtifactId: null,
            openArtifactDirty: false,
            openDelegation: null,
          }
        : { openBrowserAgentId: null },
    ),
  takeBrowserOpenRequest: () => {
    const request = get().browserOpenRequest;
    if (request) set({ browserOpenRequest: null });
    return request;
  },
});
