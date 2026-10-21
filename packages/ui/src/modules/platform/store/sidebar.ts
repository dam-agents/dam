import type { StateCreator } from "zustand";

import {
  readPersistedFlag,
  writePersistedFlag,
} from "../../../lib/persisted-prefs.js";
import {
  browserStorage,
  safeGetItem,
  safeRemoveItem,
  safeSetItem,
} from "../../../lib/safe-storage.js";
import type { PlatformStore } from "../../../store.js";
import {
  type ActivityFilters,
  defaultActivityFilters,
  isFiltered,
  parseActivityFilters,
  serializeActivityFilters,
} from "../../home/lib/activity-filter.js";
import { keepFirstSessionPages } from "../../sessions/api/queries.js";

const SIDEBAR_EXPANDED_STORAGE_KEY = "platform-sidebar-expanded";
const SIDEBAR_HIBERNATING_STORAGE_KEY = "platform-sidebar-show-hibernating";
const SIDEBAR_V2_PINNED_STORAGE_KEY = "platform-sidebar-v2-pinned";
const SIDEBAR_SESSION_FILTER_STORAGE_KEY = "platform-session-filter";

export type SidebarGroupBy = "agents" | "all";

export interface SidebarSlice {
  sidebarExpanded: boolean;
  setSidebarExpanded: (expanded: boolean) => void;
  sidebarActivityFilters: ActivityFilters;
  setSidebarActivityFilters: (filters: ActivityFilters) => void;
  sidebarGroupBy: SidebarGroupBy;
  setSidebarGroupBy: (groupBy: SidebarGroupBy) => void;
  sidebarTreeToggled: ReadonlyMap<string, boolean>;
  setSidebarTreeToggled: (toggled: ReadonlyMap<string, boolean>) => void;
  sidebarTreeOpenAgent: string | null;
  setSidebarTreeOpenAgent: (agentId: string | null) => void;
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

function readStoredSessionFilter(): ActivityFilters {
  const raw = safeGetItem(browserStorage, SIDEBAR_SESSION_FILTER_STORAGE_KEY);
  try {
    return parseActivityFilters(raw === null ? null : JSON.parse(raw));
  } catch {
    return defaultActivityFilters();
  }
}

function writeStoredSessionFilter(filters: ActivityFilters): void {
  if (isFiltered(filters))
    safeSetItem(
      browserStorage,
      SIDEBAR_SESSION_FILTER_STORAGE_KEY,
      JSON.stringify(serializeActivityFilters(filters)),
    );
  else safeRemoveItem(browserStorage, SIDEBAR_SESSION_FILTER_STORAGE_KEY);
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
  sidebarActivityFilters: readStoredSessionFilter(),
  setSidebarActivityFilters: (filters) => {
    if (isFiltered(get().sidebarActivityFilters) && !isFiltered(filters))
      keepFirstSessionPages();
    writeStoredSessionFilter(filters);
    set({ sidebarActivityFilters: filters });
  },
  sidebarGroupBy: "agents",
  setSidebarGroupBy: (groupBy) => set({ sidebarGroupBy: groupBy }),
  sidebarTreeToggled: new Map(),
  setSidebarTreeToggled: (toggled) => set({ sidebarTreeToggled: toggled }),
  sidebarTreeOpenAgent: null,
  setSidebarTreeOpenAgent: (agentId) => {
    if (agentId) set({ sidebarTreeOpenAgent: agentId });
  },
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
