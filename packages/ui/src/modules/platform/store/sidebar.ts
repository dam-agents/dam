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
const SIDEBAR_HIBERNATING_STORAGE_KEY = "platform-sidebar-show-hibernating";

export interface SidebarSlice {
  sidebarExpanded: boolean;
  setSidebarExpanded: (expanded: boolean) => void;
  sidebarShowHibernating: boolean;
  setSidebarShowHibernating: (show: boolean) => void;
  sidebarActivityFilters: ActivityFilters;
  setSidebarActivityFilters: (filters: ActivityFilters) => void;
  approvalsOpen: boolean;
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
  setApprovalsOpen: (open: boolean) => void;
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
  sidebarShowHibernating: readPersistedFlag(
    SIDEBAR_HIBERNATING_STORAGE_KEY,
    false,
  ),
  setSidebarShowHibernating: (show) => {
    writePersistedFlag(SIDEBAR_HIBERNATING_STORAGE_KEY, show);
    set({ sidebarShowHibernating: show });
  },
  sidebarActivityFilters: defaultActivityFilters(),
  setSidebarActivityFilters: (filters) =>
    set({ sidebarActivityFilters: filters }),
  approvalsOpen: false,
  mobileNavOpen: false,
  setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
  setApprovalsOpen: (open) => set({ approvalsOpen: open }),
});
