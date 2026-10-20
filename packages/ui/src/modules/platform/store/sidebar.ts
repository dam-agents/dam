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
const SIDEBAR_V2_PINNED_STORAGE_KEY = "platform-sidebar-v2-pinned";

export interface SidebarSlice {
  sidebarExpanded: boolean;
  setSidebarExpanded: (expanded: boolean) => void;
  sidebarActivityFilters: ActivityFilters;
  setSidebarActivityFilters: (filters: ActivityFilters) => void;
  sidebarShowHibernating: boolean;
  setSidebarShowHibernating: (show: boolean) => void;
  sidebarAgentOpen: Readonly<Record<string, boolean>>;
  setSidebarAgentOpen: (agentId: string, open: boolean) => void;
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
  sidebarPinned: boolean;
  setSidebarPinned: (pinned: boolean) => void;
  sidebarPeek: boolean;
  setSidebarPeek: (peek: boolean) => void;
  sidebarAgentId: string | null;
  setSidebarAgentId: (agentId: string | null) => void;
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
  sidebarShowHibernating: readPersistedFlag(
    SIDEBAR_HIBERNATING_STORAGE_KEY,
    false,
  ),
  setSidebarShowHibernating: (show) => {
    writePersistedFlag(SIDEBAR_HIBERNATING_STORAGE_KEY, show);
    set({ sidebarShowHibernating: show });
  },
  sidebarAgentOpen: {},
  setSidebarAgentOpen: (agentId, open) =>
    set((s) =>
      s.sidebarAgentOpen[agentId] === open
        ? {}
        : { sidebarAgentOpen: { ...s.sidebarAgentOpen, [agentId]: open } },
    ),
  mobileNavOpen: false,
  setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
  sidebarPinned: readPersistedFlag(SIDEBAR_V2_PINNED_STORAGE_KEY, true),
  setSidebarPinned: (pinned) => {
    writePersistedFlag(SIDEBAR_V2_PINNED_STORAGE_KEY, pinned);
    set({ sidebarPinned: pinned });
  },
  sidebarPeek: false,
  setSidebarPeek: (peek) => set({ sidebarPeek: peek }),
  sidebarAgentId: null,
  setSidebarAgentId: (agentId) => set({ sidebarAgentId: agentId }),
});
