import type { StateCreator } from "zustand";

import {
  readPersistedFlag,
  writePersistedFlag,
} from "../../lib/persisted-prefs.js";
import type { PlatformStore } from "../../store.js";

const FINISHED_LIST_OPEN_STORAGE_KEY = "platform-processes-finished-open";

export interface ProcessesSlice {
  finishedListOpen: boolean;
  openProcessOutputKey: string | null;
  setFinishedListOpen: (open: boolean) => void;
  setOpenProcessOutputKey: (key: string | null) => void;
}

export const createProcessesSlice: StateCreator<
  PlatformStore,
  [],
  [],
  ProcessesSlice
> = (set) => ({
  finishedListOpen: readPersistedFlag(FINISHED_LIST_OPEN_STORAGE_KEY, true),
  openProcessOutputKey: null,
  setFinishedListOpen: (open) => {
    writePersistedFlag(FINISHED_LIST_OPEN_STORAGE_KEY, open);
    set({ finishedListOpen: open });
  },
  setOpenProcessOutputKey: (key) =>
    set(
      key
        ? {
            openProcessOutputKey: key,
            sidePanelTab: "processes",
            openFilePath: null,
            openFileDirty: false,
            openFileEdit: false,
            openArtifactId: null,
            openArtifactDirty: false,
            openDelegation: null,
            openBrowserAgentId: null,
            openChangesAgentId: null,
          }
        : { openProcessOutputKey: null },
    ),
});
