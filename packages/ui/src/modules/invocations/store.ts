import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../store.js";

export interface OpenDelegation {
  driverAgentId: string;
  id: string;
}

export interface InvocationsSlice {
  openDelegation: OpenDelegation | null;
  setOpenDelegation: (open: OpenDelegation | null) => void;
}

export const createInvocationsSlice: StateCreator<
  PlatformStore,
  [],
  [],
  InvocationsSlice
> = (set) => ({
  openDelegation: null,
  setOpenDelegation: (open) =>
    set(
      open
        ? {
            openDelegation: open,
            openFilePath: null,
            openFileDirty: false,
            openArtifactId: null,
            openArtifactDirty: false,
          }
        : { openDelegation: null },
    ),
});
