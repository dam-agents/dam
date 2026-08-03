import type { StateCreator } from "zustand";

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

/** Views whose route carries no parameters — the only ones `setView` can reach. */
type ParameterlessView =
  | "list"
  | "inbox"
  | "terms"
  | "artifacts"
  | "experiments"
  | "knowledge-bases"
  | "sandbox-new";

export interface NavigationSlice {
  view: View;
  agentId: string | null;
  settingsTab: SettingsTab;
  sandboxSection: SandboxSection;
  setView: (v: ParameterlessView) => void;
  /** `startingPoint` pre-selects step 1, so a per-kind "New …" button lands in
   *  the shared wizard pointed at that kind. */
  navigateToCreateSandbox: (startingPoint?: StartingPoint) => void;
  navigateToSettings: (tab?: SettingsTab) => void;
  navigateToSandboxHome: (agentId: string, section?: SandboxSection) => void;
  navigateToExperiments: () => void;
  navigateToKnowledgeBases: () => void;
  navigateToKnowledgeBaseConfig: (agentId: string) => void;
  mobileScreen: "sessions" | "chat";
  setMobileScreen: (screen: "sessions" | "chat") => void;
}

/**
 * Resolve the path to hydrate from exactly once, so the `replaceState` side
 * effect below cannot race initializers that re-read `window.location`.
 */
function initialPath(): string {
  const { pathname } = window.location;
  // The Telegram/Slack bind pages are entered via an external redirect
  // carrying a one-shot ?flow= param — a stale OAuth return-view must not
  // replace them.
  const { view } = parseRoute(pathname);
  if (view === "telegram-bind" || view === "slack-bind") return pathname;

  // Holds the path to restore after an OAuth roundtrip (e.g. /settings/connections).
  const saved = sessionStorage.getItem("platform-return-view");
  if (!saved) return pathname;
  sessionStorage.removeItem("platform-return-view");
  if (!saved.startsWith("/")) {
    console.warn("[navigation] ignoring non-path platform-return-view:", saved);
    return pathname;
  }
  if (pathname !== saved) {
    history.replaceState(
      null,
      "",
      saved + window.location.search + window.location.hash,
    );
  }
  // Route on the path segment alone: a query or hash riding along in the
  // saved value would otherwise be captured as part of an id or tab.
  return saved.split(/[?#]/)[0]!;
}

export const createNavigationSlice: StateCreator<
  PlatformStore,
  [],
  [],
  NavigationSlice
> = (set) => ({
  ...routeToNavigationState(parseRoute(initialPath())),
  setView: (v) => {
    history.pushState(null, "", routeToPath({ view: v }));
    set(routeToNavigationState({ view: v }));
  },
  navigateToCreateSandbox: (startingPoint) => {
    // Seeded into the snapshot, not the route — where every other pick lives.
    // Only URL-based re-entry (refresh, OAuth return) resumes a persisted draft.
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
    // The settings form keys off `agentId`; chat keeps `selectedAgent`. Set
    // both so returning to the KB chat keeps the same agent selected.
    set({ view: "knowledge-base-config", agentId });
  },
  mobileScreen: "sessions",
  setMobileScreen: (screen) => set({ mobileScreen: screen }),
});
