import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../../store.js";
import type { ChangesFileEntry } from "../../../types.js";

export interface ChangesPanelData {
  files: ChangesFileEntry[];
  summary: string;
  selectedFile: string | null;
}

export interface ChangesPanelSlice {
  openChangesData: ChangesPanelData | null;
  setOpenChangesData: (data: ChangesPanelData | null) => void;
  setChangesSelectedFile: (path: string | null) => void;
}

export const createChangesPanelSlice: StateCreator<
  PlatformStore,
  [],
  [],
  ChangesPanelSlice
> = (set) => ({
  openChangesData: null,
  setOpenChangesData: (data) =>
    set(
      data
        ? {
            openChangesData: data,
            openFilePath: null,
            openFileDirty: false,
            openFileEdit: false,
            openArtifactId: null,
            openArtifactDirty: false,
            openBrowserAgentId: null,
            openProcessOutputKey: null,
            openDelegation: null,
            openWorkProcess: null,
            openEnvironment: null,
          }
        : { openChangesData: null },
    ),
  setChangesSelectedFile: (path) =>
    set((s) =>
      s.openChangesData
        ? { openChangesData: { ...s.openChangesData, selectedFile: path } }
        : {},
    ),
});
