import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../../store.js";
import { type Dock, dockKey, dockTab } from "../lib/dock.js";
import type { SidePanelTab } from "../lib/side-panel.js";

export interface SidePanelSlice {
  sidePanelTab: SidePanelTab | null;
  sidePanelMaximized: string | null;
  dock: Dock | null;
  artifactFullPage: boolean;
  setSidePanelTab: (tab: SidePanelTab | null) => void;
  setSidePanelMaximized: (view: string | null) => void;
  setDock: (dock: Dock | null, opts?: { edit?: boolean }) => void;
  setArtifactFullPage: (on: boolean) => void;
}

export const createSidePanelSlice: StateCreator<
  PlatformStore,
  [],
  [],
  SidePanelSlice
> = (set) => ({
  sidePanelTab: null,
  sidePanelMaximized: null,
  dock: null,
  artifactFullPage: false,
  setSidePanelTab: (tab) =>
    set(
      tab === null
        ? {
            sidePanelTab: null,
            sidePanelMaximized: null,
            artifactFullPage: false,
          }
        : { sidePanelTab: tab, artifactFullPage: false },
    ),
  setSidePanelMaximized: (view) => set({ sidePanelMaximized: view }),
  setDock: (dock, opts) =>
    set((state) => ({
      dock,
      sidePanelTab: dock ? dockTab[dock.kind] : state.sidePanelTab,
      sidePanelMaximized:
        dockKey(dock) === dockKey(state.dock) ? state.sidePanelMaximized : null,
      artifactFullPage: false,
      openFileDirty: false,
      openFileEdit: dock?.kind === "file" ? (opts?.edit ?? false) : false,
      openArtifactDirty:
        dock?.kind === "artifact" &&
        state.dock?.kind === "artifact" &&
        dock.id === state.dock.id
          ? state.openArtifactDirty
          : false,
      openArtifactEdit:
        dock?.kind === "artifact" ? (opts?.edit ?? false) : false,
    })),
  setArtifactFullPage: (on) => set({ artifactFullPage: on }),
});
