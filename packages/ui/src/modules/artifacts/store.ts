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
  artifactsSectionOpen: boolean;
  artifactFolderCollapse: Record<string, Record<string, boolean>>;
  setOpenArtifactId: (id: string | null, opts?: { edit?: boolean }) => void;
  setOpenArtifactEdit: (edit: boolean) => void;
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
  artifactsSectionOpen: readPersistedFlag(
    ARTIFACTS_SECTION_OPEN_STORAGE_KEY,
    true,
  ),
  artifactFolderCollapse: {},
  setOpenArtifactId: (id, opts) =>
    set(
      id
        ? {
            openArtifactId: id,
            openArtifactEdit: opts?.edit ?? false,
            openFilePath: null,
          }
        : { openArtifactId: id, openArtifactEdit: false },
    ),
  setOpenArtifactEdit: (edit) => set({ openArtifactEdit: edit }),
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
