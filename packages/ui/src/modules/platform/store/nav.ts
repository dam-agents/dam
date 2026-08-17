import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../../store.js";

export const NAV_EXPANDED_STORAGE_KEY = "platform-nav-expanded";

export interface NavSlice {
  navExpanded: boolean;
  setNavExpanded: (expanded: boolean) => void;
}

export function readStoredNavExpanded(): boolean {
  try {
    return localStorage.getItem(NAV_EXPANDED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export const createNavSlice: StateCreator<PlatformStore, [], [], NavSlice> = (
  set,
) => ({
  navExpanded: readStoredNavExpanded(),
  setNavExpanded: (expanded) => {
    try {
      localStorage.setItem(NAV_EXPANDED_STORAGE_KEY, expanded ? "1" : "0");
    } catch {}
    set({ navExpanded: expanded });
  },
});
