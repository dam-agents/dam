import type { StateCreator } from "zustand";

import {
  readPersistedFlag,
  writePersistedFlag,
} from "../../lib/persisted-flag.js";
import type { PlatformStore } from "../../store.js";

export const ARTIFACTS_SECTION_OPEN_STORAGE_KEY = "platform-artifacts-open";

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
  artifactsSectionOpen: readPersistedFlag(
    ARTIFACTS_SECTION_OPEN_STORAGE_KEY,
    true,
  ),
  artifactFolderCollapse: {},
  setOpenArtifactId: (id) =>
    set(
      id ? { openArtifactId: id, openFilePath: null } : { openArtifactId: id },
    ),
  setArtifactsSectionOpen: (open) => {
    writePersistedFlag(ARTIFACTS_SECTION_OPEN_STORAGE_KEY, open);
    set({ artifactsSectionOpen: open });
  },
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
