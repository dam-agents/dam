import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../../store.js";

export const SIDEBAR_EXPANDED_STORAGE_KEY = "platform-sidebar-expanded";

export interface SidebarSlice {
  sidebarExpanded: boolean;
  setSidebarExpanded: (expanded: boolean) => void;
  notificationsOpen: boolean;
  notificationsInitialTab: "activity" | "approvals";
  toggleNotifications: () => void;
  setNotificationsOpen: (open: boolean) => void;
  openApprovals: () => void;
}

export function readStoredSidebarExpanded(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_EXPANDED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export const createSidebarSlice: StateCreator<
  PlatformStore,
  [],
  [],
  SidebarSlice
> = (set) => ({
  sidebarExpanded: readStoredSidebarExpanded(),
  setSidebarExpanded: (expanded) => {
    try {
      localStorage.setItem(SIDEBAR_EXPANDED_STORAGE_KEY, expanded ? "1" : "0");
    } catch {}
    set({ sidebarExpanded: expanded });
  },
  notificationsOpen: false,
  notificationsInitialTab: "activity",
  toggleNotifications: () =>
    set((s) => ({
      notificationsOpen: !s.notificationsOpen,
      notificationsInitialTab: "activity",
    })),
  setNotificationsOpen: (open) =>
    set({ notificationsOpen: open, notificationsInitialTab: "activity" }),
  openApprovals: () =>
    set({ notificationsOpen: true, notificationsInitialTab: "approvals" }),
});
