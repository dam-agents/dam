import type { StateCreator } from "zustand";

import { resolveReturnPathname } from "../../../lib/return-path.js";
import type { PlatformStore } from "../../../store.js";
import {
  parseRoute,
  routeToNavigationState,
  routeToPath,
  type SandboxSection,
  type SettingsTab,
  type View,
} from "../lib/routes.js";

type ParameterlessView =
  | "home"
  | "terms"
  | "artifacts"
  | "coding-agents"
  | "coding-agent-new"
  | "experiments"
  | "experiment-new"
  | "knowledge-base-new"
  | "knowledge-bases";

export interface NavigationSlice {
  view: View;
  agentId: string | null;
  settingsTab: SettingsTab;
  sandboxSection: SandboxSection;
  sandboxFocus: string | null;
  clearSandboxFocus: () => void;
  hydrateRoute: () => void;
  setView: (v: ParameterlessView) => void;
  navigateToSettings: (tab?: SettingsTab) => void;
  navigateToSandboxHome: (
    agentId: string,
    section?: SandboxSection,
    focus?: string,
  ) => void;
  navigateToExperiments: () => void;
  navigateToKnowledgeBases: () => void;
  mobileScreen: "sessions" | "chat";
  setMobileScreen: (screen: "sessions" | "chat") => void;
}

function initialPath(): string {
  const { pathname } = window.location;
  const { view } = parseRoute(pathname);
  if (view === "telegram-bind" || view === "slack-bind") return pathname;

  const saved = sessionStorage.getItem("platform-return-view");
  if (!saved) return pathname;
  sessionStorage.removeItem("platform-return-view");
  const restored = resolveReturnPathname(saved, window.location.origin);
  if (!restored) {
    console.warn("[navigation] ignoring unusable platform-return-view:", saved);
    return pathname;
  }
  if (pathname !== restored) {
    history.replaceState(
      null,
      "",
      restored + window.location.search + window.location.hash,
    );
  }
  return restored;
}

export const createNavigationSlice: StateCreator<
  PlatformStore,
  [],
  [],
  NavigationSlice
> = (set) => ({
  ...routeToNavigationState(parseRoute(initialPath())),
  sandboxFocus: null,
  clearSandboxFocus: () => set({ sandboxFocus: null }),
  hydrateRoute: () =>
    set({
      ...routeToNavigationState(parseRoute(window.location.pathname)),
      sandboxFocus: null,
    }),
  setView: (v) => {
    history.pushState(null, "", routeToPath({ view: v }));
    set({ ...routeToNavigationState({ view: v }), sandboxFocus: null });
  },
  navigateToSettings: (tab) => {
    const settingsTab = tab ?? "account";
    history.pushState(null, "", routeToPath({ view: "settings", settingsTab }));
    set({ view: "settings", settingsTab, agentId: null, sandboxFocus: null });
  },
  navigateToSandboxHome: (agentId, section = "setup", focus) => {
    history.pushState(
      null,
      "",
      routeToPath({ view: "sandbox-home", agentId, sandboxSection: section }),
    );
    set({
      view: "sandbox-home",
      agentId,
      sandboxSection: section,
      sandboxFocus: focus ?? null,
    });
  },
  navigateToExperiments: () => {
    history.pushState(null, "", routeToPath({ view: "experiments" }));
    set({ view: "experiments", agentId: null, sandboxFocus: null });
  },
  navigateToKnowledgeBases: () => {
    history.pushState(null, "", routeToPath({ view: "knowledge-bases" }));
    set({ view: "knowledge-bases", agentId: null, sandboxFocus: null });
  },
  mobileScreen: "sessions",
  setMobileScreen: (screen) => set({ mobileScreen: screen }),
});
