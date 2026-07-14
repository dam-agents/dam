import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../../store.js";
import {
  pathToState,
  type SandboxSection,
  type SettingsTab,
  type View,
  viewToPath,
} from "../lib/routes.js";

export interface NavigationSlice {
  view: View;
  agentId: string | null;
  experimentId: string | null;
  settingsTab: SettingsTab;
  sandboxSection: SandboxSection;
  setView: (v: View) => void;
  navigateToCreateSandbox: () => void;
  navigateToSettings: (tab?: SettingsTab) => void;
  navigateToSandboxHome: (agentId: string, section?: SandboxSection) => void;
  navigateToExperiments: () => void;
  navigateToCreateExperiment: () => void;
  navigateToExperiment: (experimentId: string) => void;
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
  experimentId: pathToState(window.location.pathname).experimentId ?? null,
  settingsTab: pathToState(window.location.pathname).settingsTab ?? "account",
  sandboxSection:
    pathToState(window.location.pathname).sandboxSection ?? "setup",
  setView: (v) => {
    history.pushState(null, "", viewToPath(v));
    // viewToPath(v) without a tab is /settings, so keep the tab in sync.
    if (v === "settings")
      set({
        view: v,
        agentId: null,
        experimentId: null,
        settingsTab: "account",
      });
    else set({ view: v, agentId: null, experimentId: null });
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
  navigateToSandboxHome: (agentId, section = "setup") => {
    history.pushState(
      null,
      "",
      viewToPath("sandbox-home", null, agentId, null, null, section),
    );
    set({ view: "sandbox-home", agentId, sandboxSection: section });
  },
  navigateToExperiments: () => {
    history.pushState(null, "", viewToPath("experiments"));
    set({ view: "experiments", agentId: null, experimentId: null });
  },
  navigateToCreateExperiment: () => {
    history.pushState(null, "", viewToPath("experiment-new"));
    set({ view: "experiment-new", agentId: null, experimentId: null });
  },
  navigateToExperiment: (experimentId) => {
    history.pushState(
      null,
      "",
      viewToPath("experiment-detail", null, null, null, experimentId),
    );
    set({ view: "experiment-detail", agentId: null, experimentId });
  },
  mobileScreen: "sessions",
  setMobileScreen: (screen) => set({ mobileScreen: screen }),
  showMobilePanel: false,
  setShowMobilePanel: (show) => set({ showMobilePanel: show }),
});
