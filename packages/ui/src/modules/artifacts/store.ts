import type { StateCreator } from "zustand";

import {
  readPersistedFlag,
  writePersistedFlag,
} from "../../lib/persisted-prefs.js";
import type { PlatformStore } from "../../store.js";

const ARTIFACTS_SECTION_OPEN_STORAGE_KEY = "platform-artifacts-open";

export interface ArtifactsSlice {
  openArtifactEdit: boolean;
  openArtifactDirty: boolean;
  artifactsSectionOpen: boolean;
  artifactFolderCollapse: Record<string, Record<string, boolean>>;
  setOpenArtifactEdit: (edit: boolean) => void;
  setOpenArtifactDirty: (dirty: boolean) => void;
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
  openArtifactEdit: false,
  openArtifactDirty: false,
  artifactsSectionOpen: readPersistedFlag(
    ARTIFACTS_SECTION_OPEN_STORAGE_KEY,
    true,
  ),
  artifactFolderCollapse: {},
  setOpenArtifactEdit: (edit) => set({ openArtifactEdit: edit }),
  setOpenArtifactDirty: (dirty) => set({ openArtifactDirty: dirty }),
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
