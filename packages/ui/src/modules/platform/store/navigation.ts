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
  | "agents"
  | "agent-new"
  | "packs"
  | "knowledge-bases"
  | "knowledge-base-new"
  | "setup-workbench";

export interface NavigationSlice {
  view: View;
  agentId: string | null;
  settingsTab: SettingsTab;
  sandboxSection: SandboxSection;
  hydrateRoute: () => void;
  setView: (v: ParameterlessView) => void;
  navigateToSettings: (tab?: SettingsTab) => void;
  navigateToSandboxHome: (agentId: string, section?: SandboxSection) => void;
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
  navigateToKnowledgeBaseConfig: (agentId) => {
    history.pushState(
      null,
      "",
      routeToPath({ view: "sandbox-home", agentId, sandboxSection: "setup" }),
    );
    set({ view: "sandbox-home", agentId, sandboxSection: "setup" });
  },
  mobileScreen: "sessions",
  setMobileScreen: (screen) => set({ mobileScreen: screen }),
});
