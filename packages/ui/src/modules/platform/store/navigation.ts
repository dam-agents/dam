import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../../store.js";
import {
  pathToState,
  type SettingsTab,
  type View,
  viewToPath,
} from "../lib/routes.js";

export interface NavigationSlice {
  view: View;
  /** Populated when `view === "sandbox-settings"`. */
  agentId: string | null;
  /** Active sub-tab when `view === "settings"`. */
  settingsTab: SettingsTab;
  setView: (v: View) => void;
  navigateToCreateSandbox: () => void;
  navigateToSettings: (tab?: SettingsTab) => void;
  navigateToSandboxSettings: (agentId: string) => void;
  openSandboxTerminal: (agentId: string) => void;
  mobileScreen: "sessions" | "chat";
  setMobileScreen: (screen: "sessions" | "chat") => void;
  showMobilePanel: boolean;
  setShowMobilePanel: (show: boolean) => void;
}

export const createNavigationSlice: StateCreator<
  PlatformStore,
  [],
  [],
  NavigationSlice
> = (set) => ({
  view: (() => {
    // Holds the path to restore after an OAuth roundtrip (e.g. /settings/connections).
    const saved = sessionStorage.getItem("platform-return-view");
    if (saved) {
      sessionStorage.removeItem("platform-return-view");
      if (saved.startsWith("/")) {
        if (window.location.pathname !== saved) {
          history.replaceState(
            null,
            "",
            saved + window.location.search + window.location.hash,
          );
        }
        return pathToState(saved).view;
      }
      console.warn(
        "[navigation] ignoring non-path platform-return-view:",
        saved,
      );
    }
    return pathToState(window.location.pathname).view;
  })(),
  agentId: pathToState(window.location.pathname).agentId ?? null,
  settingsTab: pathToState(window.location.pathname).settingsTab ?? "account",
  setView: (v) => {
    history.pushState(null, "", viewToPath(v));
    // viewToPath(v) without a tab is /settings, so keep the tab in sync.
    if (v === "settings")
      set({ view: v, agentId: null, settingsTab: "account" });
    else set({ view: v, agentId: null });
  },
  navigateToCreateSandbox: () => {
    history.pushState(null, "", viewToPath("sandbox-new"));
    set({ view: "sandbox-new", agentId: null });
  },
  navigateToSettings: (tab) => {
    const settingsTab = tab ?? "account";
    history.pushState(
      null,
      "",
      viewToPath("settings", null, null, settingsTab),
    );
    set({ view: "settings", settingsTab, agentId: null });
  },
  navigateToSandboxSettings: (agentId) => {
    history.pushState(null, "", viewToPath("sandbox-settings", null, agentId));
    set({ view: "sandbox-settings", agentId });
  },
  openSandboxTerminal: (agentId) => {
    history.pushState(null, "", viewToPath("v2-terminal", null, agentId));
    set({ view: "v2-terminal", agentId });
  },
  mobileScreen: "sessions",
  setMobileScreen: (screen) => set({ mobileScreen: screen }),
  showMobilePanel: false,
  setShowMobilePanel: (show) => set({ showMobilePanel: show }),
});
