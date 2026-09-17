import type { StateCreator } from "zustand";

import {
  readPersistedFlag,
  writePersistedFlag,
} from "../../../lib/persisted-prefs.js";
import type { PlatformStore } from "../../../store.js";

export const SIDEBAR_EXPANDED_STORAGE_KEY = "platform-sidebar-expanded";

export interface SidebarSlice {
  sidebarExpanded: boolean;
  setSidebarExpanded: (expanded: boolean) => void;
  activityOpen: boolean;
  setActivityOpen: (open: boolean) => void;
}

export function readStoredSidebarExpanded(): boolean {
  return readPersistedFlag(SIDEBAR_EXPANDED_STORAGE_KEY, false);
}

export const createSidebarSlice: StateCreator<
  PlatformStore,
  [],
  [],
  SidebarSlice
> = (set) => ({
  sidebarExpanded: readStoredSidebarExpanded(),
  setSidebarExpanded: (expanded) => {
    writePersistedFlag(SIDEBAR_EXPANDED_STORAGE_KEY, expanded);
    set({ sidebarExpanded: expanded });
  },
  activityOpen: false,
  setActivityOpen: (open) => set({ activityOpen: open }),
});
