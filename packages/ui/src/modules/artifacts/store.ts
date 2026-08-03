import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../store.js";

export interface ArtifactsSlice {
  /** Artifact shown in the chat view's right dock; mutually exclusive with
   *  the docked file viewer (they share the dock area). */
  openArtifactId: string | null;
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
  artifactsSectionOpen: false,
  setOpenArtifactId: (id) =>
    set(
      id ? { openArtifactId: id, openFilePath: null } : { openArtifactId: id },
    ),
  setArtifactsSectionOpen: (open) => set({ artifactsSectionOpen: open }),
});
