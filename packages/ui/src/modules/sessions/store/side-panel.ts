import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../../store.js";
import {
  readSidePanelTab,
  type SidePanelTab,
  writeSidePanelTab,
} from "../lib/side-panel.js";

export interface SidePanelSlice {
  sidePanelTab: SidePanelTab | null;
  setSidePanelTab: (tab: SidePanelTab | null) => void;
}

export const createSidePanelSlice: StateCreator<
  PlatformStore,
  [],
  [],
  SidePanelSlice
> = (set) => ({
  sidePanelTab: readSidePanelTab(),
  setSidePanelTab: (tab) => {
    writeSidePanelTab(tab);
    set({ sidePanelTab: tab });
  },
});
