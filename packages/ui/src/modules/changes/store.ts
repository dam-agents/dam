import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../store.js";

export interface ChangesSlice {
  openChangesAgentId: string | null;
  setOpenChanges: (agentId: string | null) => void;
}

export const createChangesSlice: StateCreator<
  PlatformStore,
  [],
  [],
  ChangesSlice
> = (set) => ({
  openChangesAgentId: null,
  setOpenChanges: (agentId) =>
    set(
      agentId
        ? {
            openChangesAgentId: agentId,
            sidePanelTab: "changes",
            openFilePath: null,
            openFileDirty: false,
            openFileEdit: false,
            openArtifactId: null,
            openArtifactDirty: false,
            openDelegation: null,
            openBrowserAgentId: null,
            openProcessOutputKey: null,
          }
        : { openChangesAgentId: null },
    ),
});
