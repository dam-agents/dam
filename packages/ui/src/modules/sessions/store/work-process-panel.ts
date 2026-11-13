import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../../store.js";

export interface WorkProcessData {
  command: string;
  exitCode?: number;
  logLines?: string[];
  status?:
    | "running"
    | "running-awake"
    | "running-hibernates"
    | "exited"
    | "stopped"
    | "hibernated";
}

export interface WorkProcessPanelSlice {
  openWorkProcess: WorkProcessData | null;
  setOpenWorkProcess: (data: WorkProcessData | null) => void;
}

export const createWorkProcessPanelSlice: StateCreator<
  PlatformStore,
  [],
  [],
  WorkProcessPanelSlice
> = (set) => ({
  openWorkProcess: null,
  setOpenWorkProcess: (data) =>
    set(
      data
        ? {
            openWorkProcess: data,
            openFilePath: null,
            openFileDirty: false,
            openFileEdit: false,
            openArtifactId: null,
            openArtifactDirty: false,
            openBrowserAgentId: null,
            openProcessOutputKey: null,
            openProcessesPanelDocked: false,
            openDelegation: null,
            openChangesData: null,
            openEnvironment: null,
          }
        : { openWorkProcess: null },
    ),
});
