import type { StateCreator } from "zustand";

import {
  readPersistedFlag,
  writePersistedFlag,
} from "../../lib/persisted-prefs.js";
import type { PlatformStore } from "../../store.js";

const PROCESSES_SECTION_OPEN_STORAGE_KEY = "platform-processes-open";
const FINISHED_LIST_OPEN_STORAGE_KEY = "platform-processes-finished-open";

export interface ProcessesSlice {
  processesSectionOpen: boolean;
  finishedListOpen: boolean;
  openProcessOutputKey: string | null;
  setProcessesSectionOpen: (open: boolean) => void;
  setFinishedListOpen: (open: boolean) => void;
  setOpenProcessOutputKey: (key: string | null) => void;
}

export const createProcessesSlice: StateCreator<
  PlatformStore,
  [],
  [],
  ProcessesSlice
> = (set) => ({
  processesSectionOpen: readPersistedFlag(
    PROCESSES_SECTION_OPEN_STORAGE_KEY,
    true,
  ),
  finishedListOpen: readPersistedFlag(FINISHED_LIST_OPEN_STORAGE_KEY, true),
  openProcessOutputKey: null,
  setProcessesSectionOpen: (open) => {
    writePersistedFlag(PROCESSES_SECTION_OPEN_STORAGE_KEY, open);
    set({ processesSectionOpen: open });
  },
  setFinishedListOpen: (open) => {
    writePersistedFlag(FINISHED_LIST_OPEN_STORAGE_KEY, open);
    set({ finishedListOpen: open });
  },
  setOpenProcessOutputKey: (key) =>
    set(
      key
        ? {
            openProcessOutputKey: key,
            openFilePath: null,
            openFileDirty: false,
            openFileEdit: false,
            openArtifactId: null,
            openArtifactDirty: false,
            openDelegation: null,
            openBrowserAgentId: null,
          }
        : { openProcessOutputKey: null },
    ),
});
