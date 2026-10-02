import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../../store.js";

export const SIDEBAR_EXPANDED_STORAGE_KEY = "platform-sidebar-expanded";
const SIDEBAR_WIDTH_STORAGE_KEY = "platform-sidebar-width";
const DEFAULT_SIDEBAR_WIDTH = 320;
const MIN_SIDEBAR_WIDTH = 240;
const MAX_SIDEBAR_WIDTH = 480;

export { MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH };

export type ChatHeaderVariant = 1 | 2 | 3 | 4 | 5;

export interface SidebarSlice {
  sidebarExpanded: boolean;
  setSidebarExpanded: (expanded: boolean) => void;
  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;
  notificationsOpen: boolean;
  notificationsInitialTab: "activity" | "approvals";
  toggleNotifications: () => void;
  setNotificationsOpen: (open: boolean) => void;
  openApprovals: () => void;
  chatHeaderVariant: ChatHeaderVariant;
  cycleChatHeader: (direction: 1 | -1) => void;
}

export function readStoredSidebarExpanded(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_EXPANDED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function readStoredSidebarWidth(): number {
  try {
    const stored = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    if (stored) {
      const n = Number(stored);
      if (n >= MIN_SIDEBAR_WIDTH && n <= MAX_SIDEBAR_WIDTH) return n;
    }
  } catch {}
  return DEFAULT_SIDEBAR_WIDTH;
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
  sidebarWidth: readStoredSidebarWidth(),
  setSidebarWidth: (width) => {
    const clamped = Math.max(
      MIN_SIDEBAR_WIDTH,
      Math.min(MAX_SIDEBAR_WIDTH, width),
    );
    try {
      localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(clamped));
    } catch {}
    set({ sidebarWidth: clamped });
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
  chatHeaderVariant: 1,
  cycleChatHeader: (direction) =>
    set((s) => {
      const next = s.chatHeaderVariant + direction;
      return {
        chatHeaderVariant: (next < 1
          ? 5
          : next > 5
            ? 1
            : next) as ChatHeaderVariant,
      };
    }),
});
