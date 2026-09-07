import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../store.js";

export interface ArtifactsSlice {
  openArtifactId: string | null;
  artifactsSectionOpen: boolean;
  artifactFolderCollapse: Record<string, Record<string, boolean>>;
  setOpenArtifactId: (id: string | null) => void;
  setArtifactsSectionOpen: (open: boolean) => void;
  setArtifactFolderCollapsed: (
    scopeId: string,
    folderKey: string,
    collapsed: boolean,
  ) => void;
}

export const createArtifactsSlice: StateCreator<
  PlatformStore,
  [],
  [],
  ArtifactsSlice
> = (set) => ({
  openArtifactId: null,
  artifactsSectionOpen: false,
  artifactFolderCollapse: {},
  setOpenArtifactId: (id) =>
    set(
      id ? { openArtifactId: id, openFilePath: null } : { openArtifactId: id },
    ),
  setArtifactsSectionOpen: (open) => set({ artifactsSectionOpen: open }),
  setArtifactFolderCollapsed: (scopeId, folderKey, collapsed) =>
    set((state) => ({
      artifactFolderCollapse: {
        ...state.artifactFolderCollapse,
        [scopeId]: {
          ...state.artifactFolderCollapse[scopeId],
          [folderKey]: collapsed,
        },
      },
    })),
});
