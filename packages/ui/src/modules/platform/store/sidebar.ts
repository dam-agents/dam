import type { StateCreator } from "zustand";

import {
  readPersistedFlag,
  writePersistedFlag,
} from "../../../lib/persisted-prefs.js";
import type { PlatformStore } from "../../../store.js";

const SIDEBAR_EXPANDED_STORAGE_KEY = "platform-sidebar-expanded";

export type ActivityView = "feed" | "approvals";

export interface SidebarSlice {
  sidebarExpanded: boolean;
  setSidebarExpanded: (expanded: boolean) => void;
  activityView: ActivityView | null;
  setActivityView: (view: ActivityView | null) => void;
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
  activityView: null,
  setActivityView: (view) => set({ activityView: view }),
});
