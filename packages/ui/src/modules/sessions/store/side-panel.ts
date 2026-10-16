import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../../store.js";
import type { SidePanelTab } from "../lib/side-panel.js";

export interface SidePanelSlice {
  sidePanelTab: SidePanelTab | null;
  sidePanelMaximized: string | null;
  setSidePanelTab: (tab: SidePanelTab | null) => void;
  setSidePanelMaximized: (view: string | null) => void;
}

export const createSidePanelSlice: StateCreator<
  PlatformStore,
  [],
  [],
  SidePanelSlice
> = (set) => ({
  sidePanelTab: null,
  sidePanelMaximized: null,
  setSidePanelTab: (tab) =>
    set(
      tab === null
        ? { sidePanelTab: null, sidePanelMaximized: null }
        : { sidePanelTab: tab },
    ),
  setSidePanelMaximized: (view) => set({ sidePanelMaximized: view }),
});
