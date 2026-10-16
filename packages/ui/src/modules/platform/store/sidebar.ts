import type { StateCreator } from "zustand";

import {
  readPersistedFlag,
  writePersistedFlag,
} from "../../../lib/persisted-prefs.js";
import type { PlatformStore } from "../../../store.js";
import {
  type ActivityFilters,
  defaultActivityFilters,
} from "../../home/lib/activity-filter.js";

const SIDEBAR_EXPANDED_STORAGE_KEY = "platform-sidebar-expanded";

export interface SidebarSlice {
  sidebarExpanded: boolean;
  setSidebarExpanded: (expanded: boolean) => void;
  sidebarActivityFilters: ActivityFilters;
  setSidebarActivityFilters: (filters: ActivityFilters) => void;
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
}

function readStoredSidebarExpanded(): boolean {
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
  sidebarActivityFilters: defaultActivityFilters(),
  setSidebarActivityFilters: (filters) =>
    set({ sidebarActivityFilters: filters }),
  mobileNavOpen: false,
  setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
});
