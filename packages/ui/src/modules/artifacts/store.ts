import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../store.js";

export interface ArtifactsSlice {
  openArtifactId: string | null;
  openArtifactDirty: boolean;
  artifactsSectionOpen: boolean;
  setOpenArtifactId: (id: string | null) => void;
  setArtifactsSectionOpen: (open: boolean) => void;
}

export const createArtifactsSlice: StateCreator<
  PlatformStore,
  [],
  [],
  ArtifactsSlice
> = (set) => ({
  openArtifactId: null,
  openArtifactDirty: false,
  artifactsSectionOpen: false,
  setOpenArtifactId: (id) =>
    set(
      id
        ? {
            openArtifactId: id,
            openFilePath: null,
            openBrowserAgentId: null,
            openProcessOutputKey: null,
          }
        : { openArtifactId: id },
    ),
  setArtifactsSectionOpen: (open) => set({ artifactsSectionOpen: open }),
});
