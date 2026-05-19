import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../../store.js";
import {
  pathToState,
  type View,
  viewSchema,
  viewToPath,
} from "../lib/routes.js";

export interface NavigationSlice {
  view: View;
  /** Populated when `view === "agent-egress"`. */
  agentId: string | null;
  setView: (v: View) => void;
  navigateToAgentEgress: (agentId: string) => void;
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
      if (parsed.success) return parsed.data;
      console.warn(
        "[navigation] schema mismatch on platform-return-view, falling back to URL:",
        parsed.error.issues,
      );
    }
    return pathToState(window.location.pathname).view;
  })(),
  agentId: pathToState(window.location.pathname).agentId ?? null,
  setView: (v) => {
    history.pushState(null, "", viewToPath(v));
    set({ view: v, agentId: null });
  },
  navigateToAgentEgress: (agentId) => {
    history.pushState(null, "", viewToPath("agent-egress", null, agentId));
    set({ view: "agent-egress", agentId });
  },
  mobileScreen: "sessions",
  setMobileScreen: (screen) => set({ mobileScreen: screen }),
  showMobilePanel: false,
  setShowMobilePanel: (show) => set({ showMobilePanel: show }),
});
