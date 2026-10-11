import type { StateCreator } from "zustand";

import { resolveReturnPathname } from "../../../lib/return-path.js";
import type { PlatformStore } from "../../../store.js";
import {
  parseRoute,
  routeToNavigationState,
  routeToPath,
  type SandboxSection,
  type SettingsTab,
  type StarterKitCategory,
  type View,
} from "../lib/routes.js";

type ParameterlessView =
  "home" | "terms" | "artifacts" | "agent-new" | "starter-kits";

export interface NavigationSlice {
  view: View;
  agentId: string | null;
  settingsTab: SettingsTab;
  sandboxSection: SandboxSection;
  starterKitCatalog: string | null;
  starterKitId: string | null;
  starterKitCategory: StarterKitCategory | null;
  hydrateRoute: () => void;
  setView: (v: ParameterlessView) => void;
  navigateBack: () => void;
  navigateToSettings: (tab?: SettingsTab) => void;
  navigateToSandboxHome: (agentId: string, section?: SandboxSection) => void;
  navigateToStarterKit: (catalog: string, kitId: string) => void;
  navigateToStarterKitSetup: (catalog: string, kitId: string) => void;
  navigateToStarterKits: (category?: StarterKitCategory) => void;
  mobileScreen: "sessions" | "chat";
  setMobileScreen: (screen: "sessions" | "chat") => void;
}

const IN_APP_ENTRY = "in-app";

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
> = (set, get) => ({
  ...routeToNavigationState(parseRoute(initialPath())),
  hydrateRoute: () =>
    set(routeToNavigationState(parseRoute(window.location.pathname))),
  setView: (v) => {
    history.pushState(IN_APP_ENTRY, "", routeToPath({ view: v }));
    set(routeToNavigationState({ view: v }));
  },
  navigateBack: () => {
    if (history.state === IN_APP_ENTRY) history.back();
    else get().setView("home");
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
  navigateToStarterKit: (catalog, kitId) => {
    history.pushState(
      null,
      "",
      routeToPath({ view: "starter-kit", catalog, kit: kitId }),
    );
    set({
      view: "starter-kit",
      starterKitCatalog: catalog,
      starterKitId: kitId,
      agentId: null,
    });
  },
  navigateToStarterKitSetup: (catalog, kitId) => {
    history.pushState(
      null,
      "",
      routeToPath({ view: "starter-kit-new", catalog, kit: kitId }),
    );
    set({
      view: "starter-kit-new",
      starterKitCatalog: catalog,
      starterKitId: kitId,
      agentId: null,
    });
  },
  navigateToStarterKits: (category) => {
    const route = {
      view: "starter-kits" as const,
      ...(category ? { category } : {}),
    };
    history.pushState(null, "", routeToPath(route));
    set(routeToNavigationState(route));
  },
  mobileScreen: "sessions",
  setMobileScreen: (screen) => set({ mobileScreen: screen }),
});
