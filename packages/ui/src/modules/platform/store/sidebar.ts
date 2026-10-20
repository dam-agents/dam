import type { StateCreator } from "zustand";

import {
  readPersistedFlag,
  writePersistedFlag,
} from "../../../lib/persisted-prefs.js";
import type { PlatformStore } from "../../../store.js";
import {
  type ActivityFilters,
  defaultActivityFilters,
  isFiltered,
} from "../../home/lib/activity-filter.js";
import { keepFirstSessionPages } from "../../sessions/api/queries.js";

const SIDEBAR_EXPANDED_STORAGE_KEY = "platform-sidebar-expanded";
const SIDEBAR_HIBERNATING_STORAGE_KEY = "platform-sidebar-show-hibernating";
const SIDEBAR_V2_PINNED_STORAGE_KEY = "platform-sidebar-v2-pinned";

export type SidebarGroupBy = "agents" | "all";

export interface SidebarSlice {
  sidebarExpanded: boolean;
  setSidebarExpanded: (expanded: boolean) => void;
  sidebarActivityFilters: ActivityFilters;
  setSidebarActivityFilters: (filters: ActivityFilters) => void;
  sidebarGroupBy: SidebarGroupBy;
  setSidebarGroupBy: (groupBy: SidebarGroupBy) => void;
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
}

function readStoredSidebarExpanded(): boolean {
  return readPersistedFlag(SIDEBAR_EXPANDED_STORAGE_KEY, false);
}

export const createSidebarSlice: StateCreator<
  PlatformStore,
  [],
  [],
  SidebarSlice
> = (set, get) => ({
  sidebarExpanded: readStoredSidebarExpanded(),
  setSidebarExpanded: (expanded) => {
    writePersistedFlag(SIDEBAR_EXPANDED_STORAGE_KEY, expanded);
    set({ sidebarExpanded: expanded });
  },
  sidebarActivityFilters: defaultActivityFilters(),
  setSidebarActivityFilters: (filters) => {
    if (isFiltered(get().sidebarActivityFilters) && !isFiltered(filters))
      keepFirstSessionPages();
    set({ sidebarActivityFilters: filters });
  },
  sidebarGroupBy: "agents",
  setSidebarGroupBy: (groupBy) => set({ sidebarGroupBy: groupBy }),
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
});
