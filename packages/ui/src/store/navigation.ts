import type { StateCreator } from "zustand";
import type { HumrStore } from "../store.js";

export type View =
  | "list"
  | "chat"
  | "providers"
  | "connections"
  | "settings"
  | "inbox"
  | "agent-egress";

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

export function viewToPath(view: View, instance?: string | null, agentId?: string | null): string {
  if (view === "chat" && instance) return `/chat/${encodeURIComponent(instance)}`;
  if (view === "providers") return "/providers";
  if (view === "connections") return "/connections";
  if (view === "settings") return "/settings";
  if (view === "inbox") return "/inbox";
  if (view === "agent-egress" && agentId) return `/agents/${encodeURIComponent(agentId)}/egress`;
  return "/";
}

export function pathToState(path: string): { view: View; instance?: string; agentId?: string } {
  if (path.startsWith("/chat/")) return { view: "chat", instance: decodeURIComponent(path.slice(6)) };
  if (path === "/providers") return { view: "providers" };
  if (path === "/connections") return { view: "connections" };
  if (path === "/settings") return { view: "settings" };
  if (path === "/inbox") return { view: "inbox" };
  const egressMatch = path.match(/^\/agents\/([^/]+)\/egress$/);
  if (egressMatch) return { view: "agent-egress", agentId: decodeURIComponent(egressMatch[1]!) };
  return { view: "list" };
}

export const createNavigationSlice: StateCreator<HumrStore, [], [], NavigationSlice> = (set) => ({
  view: (() => {
    const saved = sessionStorage.getItem("humr-return-view");
    if (saved) {
      sessionStorage.removeItem("humr-return-view");
      return saved as View;
    }
    return pathToState(window.location.pathname).view;
  })(),
  agentId: (() => pathToState(window.location.pathname).agentId ?? null)(),
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
