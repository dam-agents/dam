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
  settingsTab: SettingsTab;
  sandboxSection: SandboxSection;
  setView: (v: View) => void;
  navigateToCreateSandbox: () => void;
  navigateToSettings: (tab?: SettingsTab) => void;
  navigateToSandboxHome: (agentId: string, section?: SandboxSection) => void;
  navigateToExperiments: () => void;
  navigateToKnowledgeBases: () => void;
  navigateToCreateKnowledgeBase: () => void;
  navigateToKnowledgeBaseConfig: (agentId: string) => void;
  mobileScreen: "sessions" | "chat";
  setMobileScreen: (screen: "sessions" | "chat") => void;
}

export const createNavigationSlice: StateCreator<
  PlatformStore,
  [],
  [],
  NavigationSlice
> = (set) => ({
  view: (() => {
    // The Telegram/Slack bind pages are entered via an external redirect
    // carrying a one-shot ?flow= param — a stale OAuth return-view must not
    // replace them.
    if (
      window.location.pathname === "/telegram/bind" ||
      window.location.pathname === "/slack/bind"
    )
      return pathToState(window.location.pathname).view;
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
  sandboxSection:
    pathToState(window.location.pathname).sandboxSection ?? "setup",
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
  navigateToSandboxHome: (agentId, section = "setup") => {
    history.pushState(
      null,
      "",
      viewToPath("sandbox-home", null, agentId, null, section),
    );
    set({ view: "sandbox-home", agentId, sandboxSection: section });
  },
  navigateToExperiments: () => {
    history.pushState(null, "", viewToPath("experiments"));
    set({ view: "experiments", agentId: null });
  },
  navigateToKnowledgeBases: () => {
    history.pushState(null, "", viewToPath("knowledge-bases"));
    set({ view: "knowledge-bases", agentId: null });
  },
  navigateToCreateKnowledgeBase: () => {
    history.pushState(null, "", viewToPath("knowledge-base-new"));
    set({ view: "knowledge-base-new", agentId: null });
  },
  navigateToKnowledgeBaseConfig: (agentId) => {
    history.pushState(
      null,
      "",
      viewToPath("knowledge-base-config", null, agentId),
    );
    // The settings form keys off `agentId`; chat keeps `selectedAgent`. Set
    // both so returning to the KB chat keeps the same agent selected.
    set({ view: "knowledge-base-config", agentId });
  },
  mobileScreen: "sessions",
  setMobileScreen: (screen) => set({ mobileScreen: screen }),
});
