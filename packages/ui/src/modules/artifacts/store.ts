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

const SECTION_OPEN_KEY = "platform-artifacts-open";

function readStoredSectionOpen(): boolean {
  try {
    return localStorage.getItem(SECTION_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function storeSectionOpen(open: boolean): void {
  try {
    localStorage.setItem(SECTION_OPEN_KEY, open ? "1" : "0");
  } catch {}
}

export const createArtifactsSlice: StateCreator<
  PlatformStore,
  [],
  [],
  ArtifactsSlice
> = (set) => ({
  openArtifactId: null,
  artifactsSectionOpen: readStoredSectionOpen(),
  artifactFolderCollapse: {},
  setOpenArtifactId: (id) =>
    set(
      id ? { openArtifactId: id, openFilePath: null } : { openArtifactId: id },
    ),
  setArtifactsSectionOpen: (open) => {
    storeSectionOpen(open);
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
