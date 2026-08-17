import type { StateCreator } from "zustand";

import { resolveReturnPathname } from "../../../lib/return-path.js";
import type { PlatformStore } from "../../../store.js";
import {
  clearSnapshot,
  EMPTY_SNAPSHOT,
  saveSnapshot,
  type StartingPoint,
  startingPointDefaults,
} from "../../sandboxes/lib/wizard-snapshot.js";
import {
  parseRoute,
  routeToNavigationState,
  routeToPath,
  type SandboxSection,
  type SettingsTab,
  type View,
} from "../lib/routes.js";

type ParameterlessView =
  | "list"
  | "inbox"
  | "terms"
  | "artifacts"
  | "coding-agents"
  | "experiments"
  | "knowledge-bases"
  | "sandbox-new";

export interface NavigationSlice {
  view: View;
  agentId: string | null;
  settingsTab: SettingsTab;
  sandboxSection: SandboxSection;
  hydrateRoute: () => void;
  setView: (v: ParameterlessView) => void;
  navigateToCreateSandbox: (startingPoint?: StartingPoint) => void;
  navigateToSettings: (tab?: SettingsTab) => void;
  navigateToSandboxHome: (agentId: string, section?: SandboxSection) => void;
  navigateToExperiments: () => void;
  navigateToKnowledgeBases: () => void;
  navigateToKnowledgeBaseConfig: (agentId: string) => void;
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
  hydrateRoute: () =>
    set(routeToNavigationState(parseRoute(window.location.pathname))),
  setView: (v) => {
    history.pushState(null, "", routeToPath({ view: v }));
    set(routeToNavigationState({ view: v }));
  },
  navigateToCreateSandbox: (startingPoint) => {
    if (startingPoint) {
      saveSnapshot({
        ...EMPTY_SNAPSHOT,
        ...startingPointDefaults(startingPoint),
      });
    } else {
      clearSnapshot();
    }
    history.pushState(null, "", routeToPath({ view: "sandbox-new" }));
    set({ view: "sandbox-new", agentId: null });
  },
  navigateToSettings: (tab) => {
    const settingsTab = tab ?? "account";
    history.pushState(null, "", routeToPath({ view: "settings", settingsTab }));
    set({ view: "settings", settingsTab, agentId: null });
  },
  navigateToSandboxHome: (agentId, section = "setup") => {
    history.pushState(
      null,
      "",
      routeToPath({ view: "sandbox-home", agentId, sandboxSection: section }),
    );
    set({ view: "sandbox-home", agentId, sandboxSection: section });
  },
  navigateToExperiments: () => {
    history.pushState(null, "", routeToPath({ view: "experiments" }));
    set({ view: "experiments", agentId: null });
  },
  navigateToKnowledgeBases: () => {
    history.pushState(null, "", routeToPath({ view: "knowledge-bases" }));
    set({ view: "knowledge-bases", agentId: null });
  },
  navigateToKnowledgeBaseConfig: (agentId) => {
    history.pushState(
      null,
      "",
      routeToPath({ view: "knowledge-base-config", agentId }),
    );
    set({ view: "knowledge-base-config", agentId });
  },
  mobileScreen: "sessions",
  setMobileScreen: (screen) => set({ mobileScreen: screen }),
});
