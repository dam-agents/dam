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
  "home" | "artifacts" | "starter-kits" | "terms" | "analytics";

export interface NavigationSlice {
  view: View;
  agentId: string | null;
  settingsTab: SettingsTab;
  usagePeriod: string | null;
  sandboxSection: SandboxSection;
  starterKitCatalog: string | null;
  starterKitId: string | null;
  kitBrowserOpen: boolean;
  hydrateRoute: () => void;
  setView: (v: ParameterlessView) => void;
  navigateBack: () => void;
  navigateToSettings: (
    tab?: SettingsTab,
    options?: { period?: string },
  ) => void;
  setUsagePeriod: (period: string) => void;
  navigateToSandboxHome: (agentId: string, section?: SandboxSection) => void;
  navigateToStarterKit: (catalog: string, kitId: string) => void;
  setKitBrowserOpen: (open: boolean) => void;
  mobileScreen: "files" | "chat";
  setMobileScreen: (screen: "files" | "chat") => void;
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

function leaveView(get: () => PlatformStore, navigate: () => void): void {
  if (get().view === "chat") get().leaveChatContext(navigate);
  else navigate();
}

export const createNavigationSlice: StateCreator<
  PlatformStore,
  [],
  [],
  NavigationSlice
> = (set, get) => ({
  ...routeToNavigationState(parseRoute(initialPath(), window.location.search)),
  kitBrowserOpen: false,
  hydrateRoute: () =>
    set(
      routeToNavigationState(
        parseRoute(window.location.pathname, window.location.search),
      ),
    ),
  setView: (v) =>
    leaveView(get, () => {
      history.pushState(IN_APP_ENTRY, "", routeToPath({ view: v }));
      set(routeToNavigationState({ view: v }));
    }),
  navigateBack: () => {
    if (history.state === IN_APP_ENTRY) history.back();
    else get().setView("home");
  },
  navigateToSettings: (tab, options) =>
    leaveView(get, () => {
      const settingsTab = tab ?? "account";
      const period = options?.period ?? null;
      history.pushState(
        null,
        "",
        routeToPath({
          view: "settings",
          settingsTab,
          ...(period ? { period } : {}),
        }),
      );
      set({
        view: "settings",
        settingsTab,
        usagePeriod: period,
        agentId: null,
      });
    }),
  setUsagePeriod: (period) => {
    history.replaceState(
      history.state,
      "",
      routeToPath({ view: "settings", settingsTab: "usage", period }),
    );
    set({ usagePeriod: period });
  },
  navigateToSandboxHome: (agentId, section = "setup") =>
    leaveView(get, () => {
      history.pushState(
        null,
        "",
        routeToPath({ view: "sandbox-home", agentId, sandboxSection: section }),
      );
      set({ view: "sandbox-home", agentId, sandboxSection: section });
    }),
  navigateToStarterKit: (catalog, kitId) =>
    leaveView(get, () => {
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
    }),
  setKitBrowserOpen: (open) => set({ kitBrowserOpen: open }),
  mobileScreen: "chat",
  setMobileScreen: (screen) => set({ mobileScreen: screen }),
});
