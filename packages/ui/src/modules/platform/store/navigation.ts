import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../../store.js";
import {
  pathToState,
  type SettingsTab,
  type View,
  viewSchema,
  viewToPath,
} from "../lib/routes.js";

export interface NavigationSlice {
  view: View;
  /** Populated when `view === "agent-egress"`. */
  agentId: string | null;
  /** Active sub-tab when `view === "settings"`. */
  settingsTab: SettingsTab;
  setView: (v: View) => void;
  navigateToSettings: (tab?: SettingsTab) => void;
  navigateToAgentEgress: (agentId: string) => void;
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
    const saved = sessionStorage.getItem("platform-return-view");
    if (saved) {
      sessionStorage.removeItem("platform-return-view");
      const parsed = viewSchema.safeParse(saved);
      if (parsed.success) {
        const target = viewToPath(parsed.data);
        if (window.location.pathname !== target) {
          history.replaceState(
            null,
            "",
            target + window.location.search + window.location.hash,
          );
        }
        return parsed.data;
      }
      console.warn(
        "[navigation] schema mismatch on platform-return-view, falling back to URL:",
        parsed.error.issues,
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
  navigateToSettings: (tab) => {
    const settingsTab = tab ?? "account";
    history.pushState(
      null,
      "",
      viewToPath("settings", null, null, settingsTab),
    );
    set({ view: "settings", settingsTab, agentId: null });
  },
  navigateToAgentEgress: (agentId) => {
    history.pushState(null, "", viewToPath("agent-egress", null, agentId));
    set({ view: "agent-egress", agentId });
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
