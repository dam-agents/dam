import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../../store.js";
import type { EnvironmentStatus } from "../../../types.js";

export interface EnvironmentPanelData {
  name: string;
  status: EnvironmentStatus;
  url?: string;
  expiresAt?: string;
  accessLabel?: string;
  items: Array<{ label: string; value: string }>;
}

export interface EnvironmentPanelSlice {
  openEnvironment: EnvironmentPanelData | null;
  setOpenEnvironment: (data: EnvironmentPanelData | null) => void;
}

export const createEnvironmentPanelSlice: StateCreator<
  PlatformStore,
  [],
  [],
  EnvironmentPanelSlice
> = (set) => ({
  openEnvironment: null,
  setOpenEnvironment: (data) =>
    set(
      data
        ? {
            openEnvironment: data,
            openFilePath: null,
            openFileDirty: false,
            openFileEdit: false,
            openArtifactId: null,
            openArtifactDirty: false,
            openBrowserAgentId: null,
            openProcessOutputKey: null,
            openDelegation: null,
            openChangesData: null,
            openWorkProcess: null,
          }
        : { openEnvironment: null },
    ),
});
