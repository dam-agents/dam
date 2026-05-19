import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../store.js";

export type RightTab = "files" | "log" | "configuration";

export interface FilesSlice {
  /** Path of the file currently open in the viewer. The content itself lives
   *  in the TanStack Query cache (see modules/files/api/queries.ts); this
   *  field is the UI-state side of the pair. */
  openFilePath: string | null;
  rightTab: RightTab;
  /** Whether the file-viewer has an unsaved in-memory edit. Surfaced here so
   *  the tree-click handler can prompt before discarding. */
  openFileDirty: boolean;
  setOpenFilePath: (path: string | null) => void;
  setRightTab: (tab: RightTab) => void;
  setOpenFileDirty: (dirty: boolean) => void;
}

export const createFilesSlice: StateCreator<
  PlatformStore,
  [],
  [],
  FilesSlice
> = (set) => ({
  openFilePath: null,
  rightTab: "files",
  openFileDirty: false,
  setOpenFilePath: (path) => set({ openFilePath: path, openFileDirty: false }),
  setRightTab: (tab) => set({ rightTab: tab }),
  setOpenFileDirty: (dirty) => set({ openFileDirty: dirty }),
});
