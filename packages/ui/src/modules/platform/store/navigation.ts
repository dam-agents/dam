import type { StateCreator } from "zustand";

import { isMobile } from "../../../lib/breakpoints.js";
import { resolveReturnPathname } from "../../../lib/return-path.js";
import type { PlatformStore } from "../../../store.js";
import {
  configRedirectTab,
  type SidePanelTab,
} from "../../sessions/lib/side-panel.js";
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
  openConfigTab: (agentId: string, tab: SidePanelTab) => void;
  navigateToStarterKit: (catalog: string, kitId: string) => void;
  setKitBrowserOpen: (open: boolean) => void;
  mobileScreen: "files" | "chat";
  setMobileScreen: (screen: "files" | "chat") => void;
}

const IN_APP_ENTRY = "in-app";

function initialPath(): string {
  const { pathname } = window.location;
  const { view } = parseRoute(pathname);
  if (
    view === "telegram-bind" ||
    view === "slack-bind" ||
    view === "connection-secret"
  )
    return pathname;

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
  navigateToSandboxHome: (agentId, section = "setup") => {
    const tab = configRedirectTab(
      get().unifiedToolbar && !get().chatBarred,
      section,
    );
    // UNIT_BOUNDARY_DESCRIPTION: with the experiment on, an Agent's configuration page has no surface of its own, so this one function every link, menu item and deep link goes through opens the chat with the panel that holds that section. With it off, the page opens as it always has — and so does a section no panel holds, which is People — and so does every section for a reader who may not use the Agent's Sessions, whom the chat route would send back here.
    if (tab !== null) {
      get().openConfigTab(agentId, tab);
      return;
    }
    leaveView(get, () => {
      history.pushState(
        null,
        "",
        routeToPath({
          view: "sandbox-home",
          agentId,
          sandboxSection: section,
        }),
      );
      set({ view: "sandbox-home", agentId, sandboxSection: section });
    });
  },
  openConfigTab: (agentId, tab) => {
    const { view, selectedAgent } = get();
    if (view === "chat" && selectedAgent === agentId) {
      set({ sidePanelTab: tab });
      if (isMobile()) set({ mobileScreen: "files" });
      return;
    }
    const path = routeToPath({ view: "chat", agent: agentId });
    const open = () => {
      history.pushState(null, "", path);
      set({ view: "chat", selectedAgent: agentId, agentId: null });
      set({ sidePanelTab: tab });
      if (isMobile()) set({ mobileScreen: "files" });
    };
    // UNIT_BOUNDARY_DESCRIPTION: coming from the configuration page's own address replaces it, so Back never returns to a page that redirects again; from another agent's chat the change goes through leaveView, which asks before dropping unsaved edits and clears that Agent's Session.
    if (view === "sandbox-home") {
      history.replaceState(null, "", path);
      set({ view: "chat", selectedAgent: agentId, agentId: null });
      set({ sidePanelTab: tab });
      if (isMobile()) set({ mobileScreen: "files" });
      return;
    }
    leaveView(get, open);
  },
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
