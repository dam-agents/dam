import type { StateCreator } from "zustand";

import {
  readPersistedFlag,
  writePersistedFlag,
} from "../../lib/persisted-prefs.js";
import type { PlatformStore } from "../../store.js";

export const ARTIFACTS_SECTION_OPEN_STORAGE_KEY = "platform-artifacts-open";

export interface ArtifactsSlice {
  openArtifactId: string | null;
  openArtifactEdit: boolean;
  openArtifactDirty: boolean;
  artifactsSectionOpen: boolean;
  artifactFolderCollapse: Record<string, Record<string, boolean>>;
  setOpenArtifactId: (id: string | null, opts?: { edit?: boolean }) => void;
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
  openArtifactId: null,
  openArtifactEdit: false,
  openArtifactDirty: false,
  artifactsSectionOpen: readPersistedFlag(
    ARTIFACTS_SECTION_OPEN_STORAGE_KEY,
    true,
  ),
  artifactFolderCollapse: {},
  setOpenArtifactId: (id, opts) =>
    set((state) =>
      id
        ? {
            openArtifactId: id,
            openArtifactEdit: opts?.edit ?? false,
            openArtifactDirty:
              id === state.openArtifactId ? state.openArtifactDirty : false,
            openFilePath: null,
            openFileDirty: false,
          }
        : {
            openArtifactId: id,
            openArtifactEdit: false,
            openArtifactDirty: false,
          },
    ),
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
