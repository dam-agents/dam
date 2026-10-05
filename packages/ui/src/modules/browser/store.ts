import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../store.js";

export interface BrowserSlice {
  openBrowserAgentId: string | null;
  setOpenBrowser: (agentId: string | null) => void;
}

export const createBrowserSlice: StateCreator<
  PlatformStore,
  [],
  [],
  BrowserSlice
> = (set) => ({
  openBrowserAgentId: null,
  setOpenBrowser: (agentId) =>
    set(
      agentId
        ? {
            openBrowserAgentId: agentId,
            openFilePath: null,
            openFileDirty: false,
            openArtifactId: null,
            openArtifactDirty: false,
            openDelegation: null,
          }
        : { openBrowserAgentId: null },
    ),
});
